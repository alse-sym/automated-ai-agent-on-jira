# AI Jira Agent - Orchestrator

Firebase Functions that orchestrate the AI Jira Agent pipeline. Receives webhooks from Jira and creates GitHub issues for Claude Code to implement or research.

## Architecture

### Implementation Flow
```
Jira Ticket (Assign to AI) → jiraOrchestrator → GitHub Issue → Claude Code CLI → PR → Deploy
```

### AI Research Flow
```
Jira Ticket (Needs AI Research) → jiraResearchOrchestrator → GitHub Issue → Claude Code CLI → Update Jira → To Do
```

## Structure

```
├── functions/
│   ├── index.js           # jiraOrchestrator & jiraResearchOrchestrator functions
│   └── package.json       # Function dependencies
├── .github/workflows/
│   └── deploy.yml         # Firebase Functions deployment
└── firebase.json          # Firebase Functions config
```

## Functions

### jiraOrchestrator

Handles implementation requests when a Jira ticket is assigned to the AI Agent.

**Trigger:** Jira Automation webhook when ticket is assigned to AI service account

**Actions:**
1. Creates GitHub Issue with `from-jira` and `ai-task` labels
2. Transitions Jira ticket to "In Progress"
3. Posts notification comment to Jira

### jiraResearchOrchestrator

Handles AI research requests when a Jira ticket needs planning before implementation.

**Trigger:** Jira Automation webhook when ticket is labeled "Needs AI Research"

**Actions:**
1. Creates GitHub Issue with `from-jira` and `ai-research` labels
2. Posts notification comment to Jira
3. (GitHub workflow then handles research, updates Jira, moves to To Do, and unassigns)

## How It Works

### Implementation Mode
1. **Jira ticket** is assigned to AI Agent service account
2. **Jira Automation** sends webhook to `jiraOrchestrator` function
3. **jiraOrchestrator** creates a GitHub Issue in the web repo with `from-jira` label
4. **Claude Code Agent** (in web repo) picks up the issue and implements the feature

### AI Research Mode
1. **Jira ticket** is labeled "Needs AI Research"
2. **Jira Automation** sends webhook to `jiraResearchOrchestrator` function
3. **jiraResearchOrchestrator** creates a GitHub Issue with `ai-research` label
4. **Claude Code Research** workflow researches codebase and creates implementation plan
5. Plan is written to Jira ticket description
6. Ticket is moved back to "To Do" and unassigned

## Configuration

### Firebase Secrets (set via CLI)

```bash
firebase functions:secrets:set GH_TOKEN          # GitHub token for creating issues
firebase functions:secrets:set WEBHOOK_SECRET    # Shared secret from Jira
firebase functions:secrets:set JIRA_BASE         # e.g. https://your-domain.atlassian.net
firebase functions:secrets:set JIRA_CLOUD_ID     # Atlassian Cloud ID (for scoped API tokens)
firebase functions:secrets:set JIRA_EMAIL        # Jira service account email
firebase functions:secrets:set JIRA_API_TOKEN    # Jira API token
```

### GitHub Secrets (for CI/CD)

- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON
- `FIREBASE_PROJECT_ID` - Firebase project ID

---

## Jira Automation Setup

You need to create two Jira Automation rules - one for implementation and one for AI research.

### Finding Your Firebase Function URLs

After deploying, your function URLs will be:
- **Implementation:** `https://europe-west3-<PROJECT_ID>.cloudfunctions.net/jiraOrchestrator`
- **AI Research:** `https://europe-west3-<PROJECT_ID>.cloudfunctions.net/jiraResearchOrchestrator`

### Rule 1: Implementation (Assign to AI Agent)

**Purpose:** Triggers when a ticket is assigned to the AI service account.

1. Go to **Project Settings** → **Automation** → **Create rule**

2. **Trigger:** `Issue assigned`
   - Add condition: Assignee equals `ai-agent@your-domain.com` (your AI service account)

3. **Action:** `Send web request`
   
   | Field | Value |
   |-------|-------|
   | **URL** | `https://europe-west3-<PROJECT_ID>.cloudfunctions.net/jiraOrchestrator` |
   | **Method** | `POST` |
   | **Web request body** | `Custom data` |
   | **Headers** | `x-webhook-secret`: `<your-webhook-secret>` |
   | **Headers** | `Content-Type`: `application/json` |

4. **Custom Data (JSON):**
   ```json
   {
     "issueKey": "{{issue.key}}",
     "summary": "{{issue.summary}}",
     "description": "{{issue.description}}",
     "repo": "your-org/your-repo"
   }
   ```

5. **Name:** `AI Agent - Start Implementation`

6. Click **Turn it on**

---

### Rule 2: AI Research (Needs AI Research Label)

**Purpose:** Triggers when the "Needs AI Research" label is added to a ticket.

1. Go to **Project Settings** → **Automation** → **Create rule**

2. **Trigger:** `Issue updated`
   - Add condition: `Labels` → `was added` → `Needs AI Research`
   
   Or use trigger: `Field value changed`
   - Field: `Labels`
   - Change type: `Any change`
   - Add condition: Labels contains `Needs AI Research`

3. **Action:** `Send web request`
   
   | Field | Value |
   |-------|-------|
   | **URL** | `https://europe-west3-<PROJECT_ID>.cloudfunctions.net/jiraResearchOrchestrator` |
   | **Method** | `POST` |
   | **Web request body** | `Custom data` |
   | **Headers** | `x-webhook-secret`: `<your-webhook-secret>` |
   | **Headers** | `Content-Type`: `application/json` |

4. **Custom Data (JSON):**
   ```json
   {
     "issueKey": "{{issue.key}}",
     "summary": "{{issue.summary}}",
     "description": "{{issue.description}}",
     "repo": "your-org/your-repo"
   }
   ```

5. **Name:** `AI Agent - Start Research`

6. Click **Turn it on**

---

### Creating the "Needs AI Research" Label

1. Go to your Jira project
2. Open any issue
3. Click on **Labels** field
4. Type `Needs AI Research` and click **Create label**

Or create via Project Settings:
1. **Project Settings** → **Labels** (if available in your Jira version)
2. Add `Needs AI Research`

---

### Testing the Automation

#### Test Implementation Flow:
1. Create a test ticket in Jira
2. Assign it to your AI service account
3. Check:
   - Firebase Function logs: `firebase functions:log`
   - GitHub repo for new issue with `from-jira` and `ai-task` labels
   - Jira ticket should transition to "In Progress"
   - Comment posted to Jira

#### Test AI Research Flow:
1. Create a test ticket in Jira
2. Add the label `Needs AI Research`
3. Check:
   - Firebase Function logs: `firebase functions:log`
   - GitHub repo for new issue with `from-jira` and `ai-research` labels
   - GitHub Actions workflow starts
   - After completion: Jira description updated, ticket moved to To Do, unassigned

---

### Troubleshooting Jira Automation

**Check Automation Audit Log:**
1. Go to **Project Settings** → **Automation**
2. Click on your rule
3. Click **Audit log** tab
4. Look for errors in recent executions

**Common Issues:**

| Issue | Solution |
|-------|----------|
| Webhook returns 401 | Check `x-webhook-secret` header matches Firebase secret |
| Webhook returns 400 | Verify JSON payload has required fields: `issueKey`, `summary`, `repo` |
| Webhook returns 502 | Check Firebase function logs for errors |
| Rule doesn't trigger | Verify trigger conditions match (assignee, label name) |
| Label not found | Create the "Needs AI Research" label first |

**View Firebase Logs:**
```bash
# View recent logs
firebase functions:log

# Stream logs in real-time
firebase functions:log --follow
```

## Local Development

```bash
# Install dependencies
npm run functions:install

# Serve locally
npm run serve

# View logs
npm run logs

# Deploy
npm run deploy
```

## Related Repositories

- [ai-jira-demo-web](https://github.com/alse-sym/ai-jira-demo-web) - Web Frontend (where Claude implements features)
