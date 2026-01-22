import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// --- Secrets (configure via Firebase CLI) ---
const GH_TOKEN = defineSecret("GH_TOKEN");                  // GitHub token (App or PAT)
const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");      // Shared secret from Jira Automation header
const JIRA_BASE = defineSecret("JIRA_BASE");                // e.g. https://your-domain.atlassian.net
const JIRA_EMAIL = defineSecret("JIRA_EMAIL");              // Jira service account email
const JIRA_API_TOKEN = defineSecret("JIRA_API_TOKEN");      // Jira API token

export const jiraOrchestrator = onRequest({
  region: "europe-west3", // pick your region
  secrets: [GH_TOKEN, WEBHOOK_SECRET, JIRA_BASE, JIRA_EMAIL, JIRA_API_TOKEN]
}, async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    // Verify shared secret (optional for testing)
    const providedSecret = req.get("x-webhook-secret");
    if (providedSecret && providedSecret !== WEBHOOK_SECRET.value()) {
      console.log("Invalid webhook secret provided");
      return res.status(401).json({ error: "invalid_secret" });
    }

    const { issueKey, summary, description, repo, ref = "main" } = req.body || {};
    if (!issueKey || !summary || !repo) {
      return res.status(400).json({ error: "missing_fields", required: ["issueKey", "summary", "repo"] });
    }

    // Check if issue already exists for this Jira key
    const [owner, name] = repo.split("/");
    console.log(`Checking for existing issue: ${issueKey}`);
    
    const searchResp = await fetch(
      `https://api.github.com/search/issues?q=${issueKey}+repo:${owner}/${name}+type:issue`,
      {
        headers: {
          "Authorization": `Bearer ${GH_TOKEN.value()}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      }
    );
    
    if (searchResp.ok) {
      const searchData = await searchResp.json();
      if (searchData.total_count > 0) {
        console.log(`Issue already exists for ${issueKey}: #${searchData.items[0].number}`);
        return res.json({ 
          ok: true, 
          skipped: true, 
          reason: "issue_exists",
          issue_number: searchData.items[0].number 
        });
      }
    }

    // Create GitHub Issue content with Jira details (description + comments)
    console.log(`Creating GitHub issue for Claude App: ${issueKey}`);

    // Fetch Jira comments
    const auth = "Basic " + Buffer.from(`${JIRA_EMAIL.value()}:${JIRA_API_TOKEN.value()}`).toString("base64");
    const jiraHeaders = { "Authorization": auth, "Accept": "application/json" };

    let commentsMarkdown = "_No comments_");
    try {
      const commentsResp = await fetch(`${JIRA_BASE.value()}/rest/api/3/issue/${issueKey}/comment?expand=renderedBody`, {
        headers: jiraHeaders
      });
      if (commentsResp.ok) {
        const commentsJson = await commentsResp.json();
        const comments = commentsJson.comments || [];
        if (comments.length > 0) {
          const stripHtml = (html) => (html || "").replace(/<[^>]+>/g, "").trim();
          commentsMarkdown = comments
            .map(c => {
              const author = (c.author && (c.author.displayName || c.author.name)) || "unknown";
              const created = c.created ? c.created.substring(0, 10) : "";
              const body = c.renderedBody ? stripHtml(c.renderedBody) : (typeof c.body === "string" ? c.body : "");
              const preview = body.length > 1000 ? `${body.substring(0, 1000)}…` : body;
              return `- ${author} (${created}):\n  ${preview}`;
            })
            .join("\n\n");
        }
      } else {
        console.log(`Failed to fetch Jira comments for ${issueKey}: ${commentsResp.status}`);
      }
    } catch (e) {
      console.log(`Error fetching Jira comments for ${issueKey}:`, e);
    }

    const jiraUrl = `${JIRA_BASE.value()}/browse/${issueKey}`;
    const issueBody = [
      `## Jira Description`,
      description || "(no description)",
      "",
      `## Jira Comments`,
      commentsMarkdown,
      "",
      `## Source`,
      `- Jira: ${jiraUrl}`
    ].join("\n");

    const ghResp = await fetch(
      `https://api.github.com/repos/${owner}/${name}/issues`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GH_TOKEN.value()}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          title: `${issueKey}: ${summary}`,
          body: issueBody,
          labels: ["from-jira", "ai-task"]
        })
      }
    );

    if (!ghResp.ok) {
      return res.status(502).json({ error: "github_request_failed", details: await ghResp.text() });
    }
    
    const issueData = await ghResp.json();
    console.log(`Created issue #${issueData.number} for ${issueKey}`);

    // Optional: pre-transition Jira to In Progress
    const tResp = await fetch(`${JIRA_BASE.value()}/rest/api/3/issue/${issueKey}/transitions`, {
      headers: { "Authorization": auth, "Accept": "application/json" }
    });
    if (tResp.ok) {
      const transitions = await tResp.json();
      const inProgress = (transitions.transitions || []).find(t => /in progress/i.test(t.name));
      if (inProgress) {
        await fetch(`${JIRA_BASE.value()}/rest/api/3/issue/${issueKey}/transitions`, {
          method: "POST",
          headers: { "Authorization": auth, "Content-Type": "application/json" },
          body: JSON.stringify({ transition: { id: inProgress.id } })
        });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal", message: String(err) });
  }
});