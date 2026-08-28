const DECISION_RANK = Object.freeze({ ALLOW: 0, REVIEW_REQUIRED: 1, DENY: 2 });
const MANDATORY_DENY = Object.freeze([
  "AGPL-3.0-only","AGPL-3.0-or-later","GPL-2.0-only","GPL-2.0-or-later",
  "GPL-3.0-only","GPL-3.0-or-later","SSPL-1.0","BUSL-1.1","UNLICENSED",
]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}
function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
}

export function validateLicensePolicy(policy) {
  assertObject(policy, "license policy");
  if (policy.schema !== "pos-platform-license-compatibility-policy/v1") throw new Error("unsupported license policy schema");
  assertObject(policy.allow, "license policy allow");
  assertStringArray(policy.review, "license policy review");
  assertStringArray(policy.deny, "license policy deny");
  assertObject(policy.allowWith, "license policy allowWith");

  const allow = new Map();
  for (const [id, obligations] of Object.entries(policy.allow)) {
    if (!id.trim()) throw new TypeError("allow license ids must be non-empty");
    assertStringArray(obligations, `allow.${id}`);
    allow.set(id, [...new Set(obligations)]);
  }
  const review = new Set(policy.review);
  const deny = new Set(policy.deny);
  const overlaps = [];
  for (const id of allow.keys()) if (review.has(id) || deny.has(id)) overlaps.push(id);
  for (const id of review) if (deny.has(id)) overlaps.push(id);
  if (overlaps.length) throw new Error(`license policy classifications overlap: ${[...new Set(overlaps)].join(", ")}`);
  for (const id of MANDATORY_DENY) if (!deny.has(id)) throw new Error(`license policy deny floor must include ${id}`);
  for (const id of ["NOASSERTION","NONE"]) if (allow.has(id)) throw new Error(`${id} cannot be auto-allowed`);

  const allowWith = new Map();
  for (const [expression, obligations] of Object.entries(policy.allowWith)) {
    if (!/^\S+ WITH \S+$/.test(expression)) throw new Error(`invalid allowWith expression: ${expression}`);
    assertStringArray(obligations, `allowWith.${expression}`);
    allowWith.set(expression, [...new Set(obligations)]);
  }
  return { allow, review, deny, allowWith };
}

function tokenize(expression) {
  if (typeof expression !== "string" || !expression.trim()) throw new TypeError("SPDX license expression must be a non-empty string");
  const tokens = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === "(" || char === ")") { tokens.push({type:char,value:char}); index += 1; continue; }
    let end = index;
    while (end < expression.length && !/\s|\(|\)/.test(expression[end])) end += 1;
    const value = expression.slice(index,end);
    const upper = value.toUpperCase();
    tokens.push({type: upper === "AND" || upper === "OR" || upper === "WITH" ? upper : "ID", value});
    index = end;
  }
  return tokens;
}

export function parseSpdxExpression(expression) {
  const tokens = tokenize(expression);
  let cursor = 0;
  const peek = () => tokens[cursor] ?? null;
  const take = (type) => {
    const token = peek();
    if (!token || token.type !== type) throw new Error(`expected ${type} in SPDX expression`);
    cursor += 1;
    return token;
  };
  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error("unexpected end of SPDX expression");
    if (token.type === "ID") { cursor += 1; return {type:"LICENSE",id:token.value}; }
    if (token.type === "(") { cursor += 1; const node = parseOr(); take(")"); return node; }
    throw new Error(`unexpected token ${token.value} in SPDX expression`);
  }
  function parseWith() {
    let node = parsePrimary();
    if (peek()?.type === "WITH") {
      if (node.type !== "LICENSE") throw new Error("WITH must apply directly to a license identifier");
      cursor += 1;
      const exception = take("ID");
      node = {type:"WITH",license:node,exception:exception.value};
    }
    return node;
  }
  function parseAnd() {
    let node = parseWith();
    while (peek()?.type === "AND") { cursor += 1; node = {type:"AND",left:node,right:parseWith()}; }
    return node;
  }
  function parseOr() {
    let node = parseAnd();
    while (peek()?.type === "OR") { cursor += 1; node = {type:"OR",left:node,right:parseAnd()}; }
    return node;
  }
  const root = parseOr();
  if (cursor !== tokens.length) throw new Error(`unexpected token ${tokens[cursor].value} in SPDX expression`);
  return root;
}

function classify(id, policy) {
  if (policy.allow.has(id)) return {decision:"ALLOW",selected:[id],obligations:policy.allow.get(id),reasons:[]};
  if (policy.deny.has(id)) return {decision:"DENY",selected:[id],obligations:[],reasons:[`DENY_LICENSE:${id}`]};
  if (policy.review.has(id)) return {decision:"REVIEW_REQUIRED",selected:[id],obligations:[],reasons:[`REVIEW_LICENSE:${id}`]};
  return {decision:"REVIEW_REQUIRED",selected:[id],obligations:[],reasons:[`UNKNOWN_LICENSE_ID:${id}`]};
}
function combineAnd(left,right) {
  const decision = DECISION_RANK[left.decision] >= DECISION_RANK[right.decision] ? left.decision : right.decision;
  return {
    decision,
    selected:[...new Set([...left.selected,...right.selected])],
    obligations:[...new Set([...left.obligations,...right.obligations])],
    reasons:[...new Set([...left.reasons,...right.reasons])],
  };
}
function combineOr(left,right) {
  const candidates=[left,right].sort((a,b)=>DECISION_RANK[a.decision]-DECISION_RANK[b.decision]);
  return {decision:candidates[0].decision,selected:[...candidates[0].selected],obligations:[...candidates[0].obligations],reasons:[...candidates[0].reasons]};
}
function evaluateNode(node,policy) {
  if (node.type === "LICENSE") return classify(node.id,policy);
  if (node.type === "AND") return combineAnd(evaluateNode(node.left,policy),evaluateNode(node.right,policy));
  if (node.type === "OR") return combineOr(evaluateNode(node.left,policy),evaluateNode(node.right,policy));
  if (node.type === "WITH") {
    const base=classify(node.license.id,policy);
    if (base.decision !== "ALLOW") return base;
    const expression=`${node.license.id} WITH ${node.exception}`;
    if (!policy.allowWith.has(expression)) return {decision:"REVIEW_REQUIRED",selected:[expression],obligations:[],reasons:[`UNREVIEWED_LICENSE_EXCEPTION:${expression}`]};
    return {decision:"ALLOW",selected:[expression],obligations:policy.allowWith.get(expression),reasons:[]};
  }
  throw new Error(`unsupported SPDX node type: ${node.type}`);
}
export function evaluateSpdxLicenseExpression(expression, policyInput) {
  const policy=validateLicensePolicy(policyInput);
  let ast;
  try { ast=parseSpdxExpression(expression); }
  catch (error) {
    return {decision:"REVIEW_REQUIRED",selected:[],obligations:[],reasons:[`INVALID_SPDX_EXPRESSION:${error instanceof Error ? error.message : String(error)}`]};
  }
  return evaluateNode(ast,policy);
}
