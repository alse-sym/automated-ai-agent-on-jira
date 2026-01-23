import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import fetch from "node-fetch";

// --- Secrets (configure via Firebase CLI) ---
const GH_TOKEN = defineSecret("GH_TOKEN");                  // GitHub token (App or PAT)
const WEBHOOK_SECRET = defineSecret("WEBHOOK_SECRET");      // Shared secret from Jira Automation header
const JIRA_BASE = defineSecret("JIRA_BASE");                // e.g. https://your-domain.atlassian.net (for browse URLs)
const JIRA_CLOUD_ID = defineSecret("JIRA_CLOUD_ID");        // Atlassian Cloud ID (for API with scoped tokens)
const JIRA_EMAIL = defineSecret("JIRA_EMAIL");              // Jira service account email
const JIRA_API_TOKEN = defineSecret("JIRA_API_TOKEN");      // Jira API token (with scopes)

// --- Jira Helper Functions ---

/**
 * Transition a Jira issue to a target status by trying multiple common transition names
 * @param {string} baseUrl - Jira base URL
 * @param {string} auth - Basic auth header value
 * @param {string} issueKey - Jira issue key (e.g., "SCRUM-123")
 * @param {string[]} targetNames - Array of transition name patterns to try
 * @returns {Promise<{success: boolean, transitionName?: string, error?: string, available?: string[]}>}
 */
async function transitionJiraIssue(baseUrl, auth, issueKey, targetNames) {
  try {
    const tResp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
      headers: { "Authorization": auth, "Accept": "application/json" }
    });

    if (!tResp.ok) {
      console.error(`Failed to get transitions for ${issueKey}: ${tResp.status}`);
      return { success: false, error: "fetch_transitions_failed", status: tResp.status };
    }

    const { transitions } = await tResp.json();
    const transitionNames = transitions.map(t => t.name);
    console.log(`Available transitions for ${issueKey}:`, transitionNames);

    // Try to find a matching transition from the target names
    const target = transitions.find(t =>
      targetNames.some(name => t.name.toLowerCase().includes(name.toLowerCase()))
    );

    if (!target) {
      console.error(`No matching transition found for ${issueKey}. Tried: [${targetNames.join(", ")}]. Available: [${transitionNames.join(", ")}]`);
      return { success: false, error: "transition_not_found", available: transitionNames };
    }

    console.log(`Transitioning ${issueKey} via "${target.name}" (id: ${target.id})`);

    const postResp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/transitions`, {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({ transition: { id: target.id } })
    });

    if (!postResp.ok) {
      const errorText = await postResp.text();
      console.error(`Transition failed for ${issueKey}: ${postResp.status} - ${errorText}`);
      return { success: false, error: "transition_failed", status: postResp.status, details: errorText };
    }

    console.log(`Successfully transitioned ${issueKey} to "${target.name}"`);
    return { success: true, transitionName: target.name };
  } catch (err) {
    console.error(`Exception transitioning ${issueKey}:`, err);
    return { success: false, error: "exception", message: String(err) };
  }
}

/**
 * Post a comment to a Jira issue
 * @param {string} baseUrl - Jira base URL
 * @param {string} auth - Basic auth header value
 * @param {string} issueKey - Jira issue key (e.g., "SCRUM-123")
 * @param {string} commentText - Plain text comment to post
 * @returns {Promise<boolean>} - true if successful
 */
async function postJiraComment(baseUrl, auth, issueKey, commentText) {
  try {
    const resp = await fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST",
      headers: { "Authorization": auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        body: {
          type: "doc",
          version: 1,
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: commentText }]
          }]
        }
      })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`Failed to post comment to ${issueKey}: ${resp.status} - ${errorText}`);
      return false;
    }

    console.log(`Posted comment to ${issueKey}`);
    return true;
  } catch (err) {
    console.error(`Exception posting comment to ${issueKey}:`, err);
    return false;
  }
}

/**
 * Get the Jira API base URL for scoped tokens
 * Scoped tokens require api.atlassian.com endpoint
 * @param {string} cloudId - Atlassian Cloud ID
 * @returns {string} - API base URL
 */
function getJiraApiUrl(cloudId) {
  return `https://api.atlassian.com/ex/jira/${cloudId}`;
}

export const jiraOrchestrator = onRequest({
  region: "europe-west3", // pick your region
  secrets: [GH_TOKEN, WEBHOOK_SECRET, JIRA_BASE, JIRA_CLOUD_ID, JIRA_EMAIL, JIRA_API_TOKEN]
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

    // Fetch Jira comments using scoped API endpoint
    const auth = "Basic " + Buffer.from(`${JIRA_EMAIL.value()}:${JIRA_API_TOKEN.value()}`).toString("base64");
    const jiraHeaders = { "Authorization": auth, "Accept": "application/json" };
    const jiraApiUrl = getJiraApiUrl(JIRA_CLOUD_ID.value());

    let commentsMarkdown = "_No comments_";
    try {
      const commentsResp = await fetch(`${jiraApiUrl}/rest/api/3/issue/${issueKey}/comment?expand=renderedBody`, {
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
      `@claude implement this:`,
      "",
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

    // Transition Jira to In Progress with multiple name variations
    const transitionResult = await transitionJiraIssue(
      jiraApiUrl,
      auth,
      issueKey,
      ["in progress", "start progress", "begin", "start work", "working"]
    );

    // Post notification comment to Jira
    const commentText = `🤖 Claude Code Agent started implementation.\n\nGitHub Issue: ${issueData.html_url}\n\nThe AI agent is now working on this ticket. You will receive updates as progress is made.`;
    await postJiraComment(jiraApiUrl, auth, issueKey, commentText);

    return res.json({ 
      ok: true, 
      issue_number: issueData.number,
      issue_url: issueData.html_url,
      jira_transition: transitionResult
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "internal", message: String(err) });
  }
});

// --- AI Research Orchestrator ---
// Triggered when a Jira ticket is labeled with "Needs AI Research"
// Creates a GitHub issue for Claude Code to research the codebase and create an implementation plan
export const jiraResearchOrchestrator = onRequest({
  region: "europe-west3",
  secrets: [GH_TOKEN, WEBHOOK_SECRET, JIRA_BASE, JIRA_CLOUD_ID, JIRA_EMAIL, JIRA_API_TOKEN]
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

    const [owner, name] = repo.split("/");
    console.log(`[Research] Processing AI research request for: ${issueKey}`);

    // Check if a research-request issue already exists for this Jira key
    const searchResp = await fetch(
      `https://api.github.com/search/issues?q=${issueKey}+repo:${owner}/${name}+type:issue+label:ai-research+state:open`,
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
        console.log(`[Research] Research request already exists for ${issueKey}: #${searchData.items[0].number}`);
        return res.json({
          ok: true,
          skipped: true,
          reason: "research_request_exists",
          issue_number: searchData.items[0].number
        });
      }
    }

    // Fetch Jira comments using scoped API endpoint
    const auth = "Basic " + Buffer.from(`${JIRA_EMAIL.value()}:${JIRA_API_TOKEN.value()}`).toString("base64");
    const jiraHeaders = { "Authorization": auth, "Accept": "application/json" };
    const jiraApiUrl = getJiraApiUrl(JIRA_CLOUD_ID.value());

    let commentsMarkdown = "_No comments_";
    try {
      const commentsResp = await fetch(`${jiraApiUrl}/rest/api/3/issue/${issueKey}/comment?expand=renderedBody`, {
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
        console.log(`[Research] Failed to fetch Jira comments for ${issueKey}: ${commentsResp.status}`);
      }
    } catch (e) {
      console.log(`[Research] Error fetching Jira comments for ${issueKey}:`, e);
    }

    // Create GitHub Issue for AI research (different labels and instruction)
    const jiraUrl = `${JIRA_BASE.value()}/browse/${issueKey}`;
    const issueBody = [
      `@claude research this:`,
      "",
      `## Jira Description`,
      description || "(no description)",
      "",
      `## Jira Comments`,
      commentsMarkdown,
      "",
      `## Source`,
      `- Jira: ${jiraUrl}`,
      "",
      `## Instructions`,
      `Research the codebase and create a detailed implementation plan for this ticket.`,
      `The plan should be written back to the Jira ticket description.`,
      `After completing the research, move the ticket back to "To Do" and unassign it.`
    ].join("\n");

    console.log(`[Research] Creating GitHub issue for AI research: ${issueKey}`);

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
          title: `${issueKey}: [AI Research] ${summary}`,
          body: issueBody,
          labels: ["from-jira", "ai-research"]
        })
      }
    );

    if (!ghResp.ok) {
      return res.status(502).json({ error: "github_request_failed", details: await ghResp.text() });
    }

    const issueData = await ghResp.json();
    console.log(`[Research] Created AI research issue #${issueData.number} for ${issueKey}`);

    // Post notification comment to Jira
    const commentText = `🔍 Claude Code Agent started AI research.\n\nGitHub Issue: ${issueData.html_url}\n\nThe AI agent is researching the codebase and will update the ticket description with an implementation plan.`;
    await postJiraComment(jiraApiUrl, auth, issueKey, commentText);

    return res.json({
      ok: true,
      issue_number: issueData.number,
      issue_url: issueData.html_url,
      action: "research_request_created"
    });
  } catch (err) {
    console.error("[Research] Error:", err);
    return res.status(500).json({ error: "internal", message: String(err) });
  }
});