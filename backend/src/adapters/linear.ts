import type { LinearIssue, SourceAdapter } from "./types.js";
import type { LinearTeam } from "@life-console/shared";
import { readSettings } from "../settings.js";

// Linear via personal API key (LINEAR_API_KEY in .env). No OAuth: the key
// goes in the Authorization header as-is (no "Bearer" — Linear's quirk).
// Toggle via settings.json → sources.linear; sync scope via settings.json →
// linear (team keys + assigned_only). runLinearSync (synthesis.ts) upserts
// results into the items table every 10 min and via POST /api/sync/linear.

const API_URL = "https://api.linear.app/graphql";

async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: process.env.LINEAR_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`linear fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`linear graphql: ${json.errors[0].message}`);
  }
  return json.data!;
}

const ISSUE_FIELDS = `id identifier title description url dueDate priority
        team { key }
        assignee { displayName }
        state { name type }`;

const ISSUES_QUERY = `
  query Issues($filter: IssueFilter, $after: String) {
    issues(filter: $filter, first: 100, after: $after) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type IssueNode = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  dueDate: string | null;
  priority: number | null;
  team: { key: string } | null;
  assignee: { displayName: string } | null;
  state: { name: string; type: string } | null;
};

const nodeToIssue = (n: IssueNode): LinearIssue => ({
  external_id: n.id,
  identifier: n.identifier,
  team: n.team?.key ?? "",
  title: n.title,
  description: n.description?.trim() || null,
  assignee: n.assignee?.displayName ?? null,
  due_date: n.dueDate,
  priority: n.priority ?? 0,
  url: n.url,
  state: n.state?.name ?? null,
  state_type: n.state?.type ?? null,
});

// Teams + active members, for the send-to-Linear modal.
export async function fetchLinearTeams(): Promise<LinearTeam[]> {
  const data = await gql<{
    teams: {
      nodes: {
        id: string;
        key: string;
        name: string;
        members: { nodes: { id: string; displayName: string; active: boolean }[] };
      }[];
    };
  }>(`query { teams { nodes { id key name
        members { nodes { id displayName active } } } } }`);
  return data.teams.nodes.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    members: t.members.nodes
      .filter((m) => m.active)
      .map((m) => ({ id: m.id, name: m.displayName })),
  }));
}

export async function createLinearIssue(input: {
  teamId: string;
  title: string;
  assigneeId?: string | null;
  priority?: number; // Linear scale 0-4
  dueDate?: string | null;
  description?: string | null;
}): Promise<LinearIssue> {
  const data = await gql<{
    issueCreate: { success: boolean; issue: IssueNode | null };
  }>(
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { ${ISSUE_FIELDS} }
      }
    }`,
    {
      input: {
        teamId: input.teamId,
        title: input.title,
        ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
        ...(input.priority != null ? { priority: input.priority } : {}),
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        ...(input.description?.trim()
          ? { description: input.description.trim() }
          : {}),
      },
    },
  );
  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error("linear issueCreate failed");
  }
  return nodeToIssue(data.issueCreate.issue);
}

// Edit an issue in place (detail modal): title, description, team (moves the
// issue — identifier changes), assignee (null = unassign), priority, due date.
// Returns the updated issue so the local row can be refreshed from it.
export async function updateLinearIssue(
  externalId: string,
  input: {
    title?: string;
    description?: string | null;
    teamId?: string;
    assigneeId?: string | null;
    priority?: number; // Linear scale 0-4
    dueDate?: string | null;
  },
): Promise<LinearIssue> {
  const data = await gql<{
    issueUpdate: { success: boolean; issue: IssueNode | null };
  }>(
    `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { ${ISSUE_FIELDS} }
      }
    }`,
    { id: externalId, input },
  );
  if (!data.issueUpdate.success || !data.issueUpdate.issue) {
    throw new Error("linear issueUpdate failed");
  }
  return nodeToIssue(data.issueUpdate.issue);
}

// Move an issue to its team's first state of the given type. Used to push a
// local check-off ("completed"), reopen ("unstarted"), or the detail modal's
// backlog / todo / in-progress buttons — so the next sync doesn't undo it.
export async function setLinearIssueState(
  externalId: string,
  type: "backlog" | "unstarted" | "started" | "completed",
): Promise<void> {
  const data = await gql<{
    issue: {
      team: { states: { nodes: { id: string; type: string; position: number }[] } };
    };
  }>(
    `query IssueStates($id: String!) {
      issue(id: $id) { team { states { nodes { id type position } } } }
    }`,
    { id: externalId },
  );
  const state = data.issue.team.states.nodes
    .filter((s) => s.type === type)
    .sort((a, b) => a.position - b.position)[0];
  if (!state) throw new Error(`linear: no "${type}" state on team`);
  const upd = await gql<{ issueUpdate: { success: boolean } }>(
    `mutation SetState($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }`,
    { id: externalId, stateId: state.id },
  );
  if (!upd.issueUpdate.success) throw new Error("linear issueUpdate failed");
}

export const linear: SourceAdapter = {
  name: "linear",
  enabled() {
    return readSettings().sources.linear && Boolean(process.env.LINEAR_API_KEY);
  },

  // Open issues only — completed/canceled ones are detected by their absence
  // and closed locally (see syncLinearItems in queries.ts).
  async fetchLinearIssues(): Promise<LinearIssue[]> {
    const scope = readSettings().linear;
    const filter: Record<string, unknown> = {
      state: { type: { nin: ["completed", "canceled"] } },
    };
    if (scope.teams.length) filter.team = { key: { in: scope.teams } };
    // "mine": on my plate, or tickets I sent to someone else (so issues
    // created here for teammates stay visible and update as they complete).
    if (scope.assigned_only) {
      filter.or = [
        { assignee: { isMe: { eq: true } } },
        { creator: { isMe: { eq: true } } },
      ];
    }

    const out: LinearIssue[] = [];
    let after: string | null = null;
    do {
      const data: {
        issues: {
          nodes: IssueNode[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      } = await gql(ISSUES_QUERY, { filter, after });
      for (const n of data.issues.nodes) out.push(nodeToIssue(n));
      after = data.issues.pageInfo.hasNextPage
        ? data.issues.pageInfo.endCursor
        : null;
    } while (after);
    return out;
  },
};
