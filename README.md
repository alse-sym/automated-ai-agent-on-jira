# AI Jira Agent - Orchestrator

Firebase Functions that orchestrate the AI Jira Agent pipeline. Receives webhooks from Jira and creates GitHub issues for Claude Code to implement.

## Architecture

```
Jira Ticket → [This Orchestrator] → GitHub Issue → Claude Code CLI → PR → Deploy
```

## Structure

```
├── functions/
│   ├── index.js           # jiraOrchestrator function
│   └── package.json       # Function dependencies
├── .github/workflows/
│   └── deploy.yml         # Firebase Functions deployment
└── firebase.json          # Firebase Functions config
```

## How It Works

1. **Jira ticket** is assigned to AI Agent service account
2. **Jira Automation** sends webhook to `jiraOrchestrator` function
3. **jiraOrchestrator** creates a GitHub Issue in the web repo with `from-jira` label
4. **Claude Code Agent** (in web repo) picks up the issue and implements the feature

## Configuration

### Firebase Secrets (set via CLI)

```bash
firebase functions:secrets:set GH_TOKEN          # GitHub token for creating issues
firebase functions:secrets:set WEBHOOK_SECRET    # Shared secret from Jira
firebase functions:secrets:set JIRA_BASE         # e.g. https://your-domain.atlassian.net
firebase functions:secrets:set JIRA_EMAIL        # Jira service account email
firebase functions:secrets:set JIRA_API_TOKEN    # Jira API token
```

### GitHub Secrets (for CI/CD)

- `FIREBASE_SERVICE_ACCOUNT` - Firebase service account JSON
- `FIREBASE_PROJECT_ID` - Firebase project ID

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
