// Fetches open PRs for the authenticated GitHub user via the GraphQL API.

const PR_FIELDS = `
  fragment PR on PullRequest {
    id number title url isDraft createdAt updatedAt reviewDecision
    repository { nameWithOwner }
    author { login avatarUrl }
    reviewRequests(first: 10) {
      totalCount
      nodes { requestedReviewer { ... on User { login } ... on Team { name } } }
    }
    latestOpinionatedReviews(first: 20) {
      nodes { state author { login avatarUrl } }
    }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }
`;

const QUERY = `
  query ArcSidebarPRs($mine: String!, $review: String!, $assigned: String!, $withAssigned: Boolean!) {
    viewer { login }
    mine: search(query: $mine, type: ISSUE, first: 50) { issueCount nodes { ...PR } }
    review: search(query: $review, type: ISSUE, first: 50) { issueCount nodes { ...PR } }
    assigned: search(query: $assigned, type: ISSUE, first: 50) @include(if: $withAssigned) {
      issueCount nodes { ...PR }
    }
  }
  ${PR_FIELDS}
`;

const BASE = 'is:pr is:open archived:false sort:updated-desc';

export function normalizePR(n) {
  const reviews = n.latestOpinionatedReviews?.nodes?.filter(Boolean) || [];
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository?.nameWithOwner || '',
    author: n.author?.login || 'ghost',
    authorAvatar: n.author?.avatarUrl || '',
    isDraft: !!n.isDraft,
    reviewDecision: n.reviewDecision || null,
    approvals: reviews.filter((r) => r.state === 'APPROVED').length,
    changesRequested: reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length,
    reviewers: reviews.map((r) => ({
      login: r.author?.login || 'ghost',
      avatar: r.author?.avatarUrl || '',
      state: r.state,
    })),
    pendingReviewers: (n.reviewRequests?.nodes || [])
      .map((r) => r?.requestedReviewer?.login || r?.requestedReviewer?.name)
      .filter(Boolean),
    checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state || null,
    updatedAt: n.updatedAt,
  };
}

function prList(search) {
  return (search?.nodes || []).filter((n) => n && n.number != null).map(normalizePR);
}

export async function fetchPRs(token, { includeAssigned = false, fetchImpl = fetch } = {}) {
  const res = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        mine: `${BASE} author:@me`,
        review: `${BASE} review-requested:@me`,
        assigned: `${BASE} assignee:@me -author:@me`,
        withAssigned: !!includeAssigned,
      },
    }),
  });
  if (res.status === 401) throw new Error('GitHub rejected the token (401). Update it in Settings.');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  const json = await res.json();
  if (!json.data) {
    throw new Error((json.errors || []).map((e) => e.message).join('; ') || 'Unknown GitHub error');
  }
  return {
    login: json.data.viewer?.login || '',
    mine: prList(json.data.mine),
    reviewRequested: prList(json.data.review),
    assigned: includeAssigned ? prList(json.data.assigned) : [],
    warnings: (json.errors || []).map((e) => e.message),
  };
}
