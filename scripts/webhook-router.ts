#!/usr/bin/env npx tsx
/**
 * Webhook Event Router Script
 * Routes GitHub webhook events to appropriate handlers
 */

const [, , eventType, action, identifier] = process.argv;

interface EventHandler {
  (action: string, identifier: string): Promise<void>;
}

const handlers: Record<string, EventHandler> = {
  async issue(action: string, issueNumber: string): Promise<void> {
    console.log(`[Issue Router] Processing issue #${issueNumber} - Action: ${action}`);

    switch (action) {
      case 'opened':
        console.log('  -> New issue opened. Ready for IssueAgent processing.');
        break;
      case 'labeled':
        console.log('  -> Issue labeled. State transition may be required.');
        break;
      case 'closed':
        console.log('  -> Issue closed.');
        break;
      case 'reopened':
        console.log('  -> Issue reopened.');
        break;
      case 'assigned':
        console.log('  -> Issue assigned.');
        break;
      default:
        console.log(`  -> Unhandled action: ${action}`);
    }
  },

  async pr(action: string, prNumber: string): Promise<void> {
    console.log(`[PR Router] Processing PR #${prNumber} - Action: ${action}`);

    switch (action) {
      case 'opened':
        console.log('  -> New PR opened. Ready for ReviewAgent processing.');
        break;
      case 'closed':
        console.log('  -> PR closed.');
        break;
      case 'reopened':
        console.log('  -> PR reopened.');
        break;
      case 'review_requested':
        console.log('  -> Review requested.');
        break;
      case 'ready_for_review':
        console.log('  -> PR ready for review.');
        break;
      default:
        console.log(`  -> Unhandled action: ${action}`);
    }
  },

  async push(branch: string, commitSha: string): Promise<void> {
    console.log(`[Push Router] Processing push to ${branch} @ ${commitSha.substring(0, 7)}`);

    if (branch === 'main') {
      console.log('  -> Push to main branch. DeploymentAgent may be triggered.');
    } else if (branch.startsWith('feat/')) {
      console.log('  -> Feature branch push.');
    } else if (branch.startsWith('fix/')) {
      console.log('  -> Fix branch push.');
    }
  },

  async comment(issueNumber: string, author: string): Promise<void> {
    console.log(`[Comment Router] Processing comment on #${issueNumber} by ${author}`);

    const commentBody = process.env.COMMENT_BODY || '';

    if (commentBody.startsWith('/agent')) {
      console.log('  -> Agent command detected. CoordinatorAgent may be triggered.');
    } else if (commentBody.startsWith('/deploy')) {
      console.log('  -> Deploy command detected.');
    } else {
      console.log('  -> Regular comment. No action required.');
    }
  },
};

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Webhook Event Router - Miyabi Framework');
  console.log('='.repeat(60));

  if (!eventType) {
    console.error('Usage: webhook-router.ts <event-type> <action> <identifier>');
    console.error('Event types: issue, pr, push, comment');
    process.exit(1);
  }

  const handler = handlers[eventType];
  if (!handler) {
    console.error(`Unknown event type: ${eventType}`);
    console.error('Valid types: issue, pr, push, comment');
    process.exit(1);
  }

  try {
    await handler(action || '', identifier || '');
    console.log('='.repeat(60));
    console.log('Event routing completed successfully.');
  } catch (error) {
    console.error('Error routing event:', error);
    process.exit(1);
  }
}

main();
