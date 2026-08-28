/**
 * protocol — ARCHITECTURE.md §6.7. Request/reply pairing, handler and sender
 * coverage, and protocol purity.
 *
 * **How the members are enumerated is the load-bearing step, and every rule
 * below depends on it:** the union members come from a **TypeScript AST pass
 * over the `ToEngine` and `FromEngine` declarations**, reading each member's
 * `type` literal off the declared type. They are never grepped out of
 * `messages.ts`. If they were, rule 1 would compare the file that declares
 * `REPLY_OF` to itself and pass no matter what either contained — and §10.4's
 * refusal to generate the table stands or falls on exactly that distinction.
 *
 * `REPLY_OF` and `UNSOLICITED` are **imported as values**, so the map this
 * check reads is the map the running page reads. The two sides of rule 1 are
 * therefore a declaration and a value, not two greps of one file.
 *
 * A declared-but-never-emitted message is this project's recurring defect,
 * recorded three separate times, and a check of this shape is the only thing
 * that has ever caught it. So "declared" is never enough here: a message must
 * have a sender, a handler and a **receiver that writes it into state**.
 */

import ts from 'typescript'
import { existsSync } from 'node:fs'
import { REPLY_OF, UNSOLICITED } from '../../src/protocol/messages'
import { parseFile, tsFiles } from './purity'

const MESSAGES = 'src/protocol/messages.ts'
const HOST = 'src/engine/host.ts'
const STORE = 'src/client/store.ts'
const WIRE = 'src/engine/wire.ts'

/**
 * The identifier `store.ts` keeps the view in. Rule 3 asks whether a case
 * *writes* it, so the check has to know its name; renaming it turns this check
 * red naming the case it could not see a write in, which is the correct
 * failure rather than a silent one.
 */
const STORE_BINDING = 'view'

interface Rule {
  name: string
  statement: string
  failures: string[]
  notes: string[]
}

const rule = (name: string, statement: string): Rule => ({ name, statement, failures: [], notes: [] })

// ------------------------------------------------------------------- AST reads

/** The `type` string literals of every member of a union type alias. */
function unionMembers(sf: ts.SourceFile, alias: string): string[] {
  const found: string[] = []
  for (const statement of sf.statements) {
    if (!ts.isTypeAliasDeclaration(statement) || statement.name.text !== alias) continue
    const members = ts.isUnionTypeNode(statement.type) ? statement.type.types : [statement.type]
    for (const member of members) {
      const literal = ts.isTypeLiteralNode(member) ? discriminant(member) : null
      if (literal !== null) found.push(literal)
    }
  }
  return found
}

function discriminant(member: ts.TypeLiteralNode): string | null {
  for (const property of member.members) {
    if (!ts.isPropertySignature(property) || property.name.getText() !== 'type') continue
    const type = property.type
    if (type && ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return type.literal.text
  }
  return null
}

/** Every `{ type: '<literal>', ... }` object literal built in a file, by type string. */
function constructedIn(path: string): Set<string> {
  const built = new Set<string>()
  const sf = parseFile(path)
  const walk = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'type') continue
        if (ts.isStringLiteral(property.initializer)) built.add(property.initializer.text)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return built
}

/** The statements of each `case '<literal>':` in a file, by literal. */
function caseBodies(path: string): Map<string, ts.NodeArray<ts.Statement>> {
  const bodies = new Map<string, ts.NodeArray<ts.Statement>>()
  const sf = parseFile(path)
  const walk = (node: ts.Node): void => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) {
      bodies.set(node.expression.text, node.statements)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return bodies
}

// -------------------------------------------------------------------- the rules

/** Rule 1: one vocabulary. The map, the two unions, and nothing outside them. */
function pairing(toEngine: string[], fromEngine: string[]): Rule {
  const check = rule('pairing', "REPLY_OF's keys are exactly ToEngine's members; its values are all in FromEngine; neither union has a member outside REPLY_OF and UNSOLICITED")
  const keys = Object.keys(REPLY_OF)
  const replies: string[] = Object.values(REPLY_OF)
  for (const key of keys) {
    if (!toEngine.includes(key)) check.failures.push(`REPLY_OF has the key '${key}', which is not a member of ToEngine — the map pairs a request that cannot be sent (§6.1)`)
  }
  for (const member of toEngine) {
    if (!keys.includes(member)) check.failures.push(`ToEngine has '${member}' and REPLY_OF does not — a request with no declared reply is a request whose reply nothing can be checked against (§6.1)`)
  }
  for (const reply of replies) {
    if (!fromEngine.includes(reply)) check.failures.push(`REPLY_OF names '${reply}' as a reply and FromEngine has no such member (§6.1)`)
  }
  const universe = [...replies, ...UNSOLICITED]
  for (const member of fromEngine) {
    if (!universe.includes(member)) check.failures.push(`FromEngine has '${member}', which is neither a reply in REPLY_OF nor listed in UNSOLICITED — this is the shape that hid eight messages from this check (§6.1)`)
  }
  check.notes.push(`${toEngine.length} ToEngine, ${fromEngine.length} FromEngine, ${keys.length} paired, ${UNSOLICITED.length} unsolicited`)
  return check
}

/** Rule 2: every request has a handler, and exactly one layer may build it. */
function handlers(toEngine: string[]): Rule {
  const check = rule('handlers', `every ToEngine member is constructed under src/client/**, never under src/ui/** or src/app/**, and has a non-empty case in ${HOST}`)
  const bodies = caseBodies(HOST)
  const client = union(tsFiles('src/client'))
  const render = union([...tsFiles('src/ui'), ...tsFiles('src/app')])
  for (const member of toEngine) {
    const body = bodies.get(member)
    if (!body) check.failures.push(`${HOST} has no case for '${member}' — a request the engine cannot answer (§6.7 rule 2)`)
    else if (body.length === 0) check.failures.push(`${HOST}'s case for '${member}' is empty — a handler that handles nothing is the declared-but-never-served defect (§6.7 rule 2)`)
    if (!client.has(member)) check.failures.push(`no file under src/client/** constructs '${member}' — a message in the union with no way to send it (§5.8)`)
    if (render.has(member)) check.failures.push(`a file under src/ui/** or src/app/** constructs '${member}' — the UI imports an action, never a message type (§5.8 rule 1)`)
  }
  return check
}

/** Rule 3: every event is emitted by the engine and written into the client's state. */
function receipts(fromEngine: string[]): Rule {
  const check = rule('receipts', `every FromEngine member is constructed under src/engine/** and has a case in ${STORE} whose body writes \`${STORE_BINDING}\` from the message`)
  const engine = union(tsFiles('src/engine'))
  const client = union(tsFiles('src/client'))
  const bodies = caseBodies(STORE)
  for (const member of fromEngine) {
    if (!engine.has(member) && !client.has(member)) {
      check.failures.push(`nothing under src/engine/** or src/client/** constructs '${member}' — it is declared and never emitted, which is the defect this check exists for (§6.7 rule 3)`)
    }
    const body = bodies.get(member)
    if (!body) {
      check.failures.push(`${STORE} has no case for '${member}' — the engine can send a message the page will never show (§6.7 rule 3)`)
      continue
    }
    if (!writesState(body)) {
      check.failures.push(`${STORE}'s case for '${member}' does not assign \`${STORE_BINDING}\` from \`message\` — an empty case, or one that only logs, satisfies "handled somewhere" and shows the operator nothing (§6.7 rule 3)`)
    }
  }
  return check
}

/** A case body counts as a write only if it assigns the view **from the message**. */
function writesState(body: ts.NodeArray<ts.Statement>): boolean {
  let wrote = false
  const walk = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left.getText().split('.')[0]
      if (target === STORE_BINDING && node.right.getText().includes('message')) wrote = true
    }
    ts.forEachChild(node, walk)
  }
  for (const statement of body) walk(statement)
  return wrote
}

/** Rule 4: the keystone holds no behaviour and no mutable state. */
function purity(): Rule {
  const check = rule('protocol-purity', 'src/protocol/** contains no function, class, let, var or new, and every exported value is `as const`')
  for (const path of tsFiles('src/protocol')) {
    const sf = parseFile(path)
    const walk = (node: ts.Node): void => {
      const banned = bannedConstruct(node)
      if (banned !== null) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        check.failures.push(`${path}:${line + 1} holds a \`${banned}\` — §2 rests the whole realm split on protocol holding no behaviour and no mutable state (§6.7 rule 4)`)
      }
      if (ts.isVariableStatement(node) && exported(node)) {
        for (const declaration of node.declarationList.declarations) {
          const initializer = declaration.initializer
          const asConst = initializer && ts.isAsExpression(initializer) && initializer.type.getText() === 'const'
          if (!asConst) check.failures.push(`${path}: exported value \`${declaration.name.getText()}\` is not \`as const\` — a widened value is a value something can reassign a member of (§6.7 rule 4)`)
        }
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
  }
  return check
}

function bannedConstruct(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return 'function'
  if (ts.isClassDeclaration(node)) return 'class'
  if (ts.isNewExpression(node)) return 'new'
  if (ts.isVariableDeclarationList(node)) {
    if (node.flags & ts.NodeFlags.Let) return 'let'
    if (!(node.flags & ts.NodeFlags.Const)) return 'var'
  }
  return null
}

function exported(node: ts.VariableStatement): boolean {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

/**
 * Rule 5 — §7.4's `SHAPE_PAIRS`, and the verdict its probation asked 3.2 for.
 *
 * §7.4 put the rule on probation until the coder who built the protocol could
 * say whether it survived as specified. It does, and it is **not exercisable
 * yet**: it pairs wire shapes with the storage records they mirror, and the
 * records arrive with the database at 3.4. Writing the pass now would mean
 * writing it against an empty table — a check that passes by having no
 * subject, which is the one shape §8 opens by refusing.
 *
 * So it reports PENDING and it is not silent: the moment `engine/wire.ts`
 * exists, this goes red until the pass is written, rather than the file
 * arriving beside a rule nobody remembered.
 */
function shapePairs(): Rule {
  const check = rule('shape-pairs', `every pair in ${WIRE}'s SHAPE_PAIRS is a shared field or a declared derivation (§7.4)`)
  if (!existsSync(WIRE)) {
    check.notes.push(`${WIRE} does not exist yet — the wire shapes it pairs mirror storage records, and those arrive with the database at 3.4. PENDING`)
    return check
  }
  check.failures.push(`${WIRE} exists and this rule was never written — §7.4's pairing is now unchecked, and a wire shape diverging from its record is exactly what it was ruled for`)
  return check
}

function union(paths: string[]): Set<string> {
  const all = new Set<string>()
  for (const path of paths) for (const type of constructedIn(path)) all.add(type)
  return all
}

const source = parseFile(MESSAGES)
const toEngine = unionMembers(source, 'ToEngine')
const fromEngine = unionMembers(source, 'FromEngine')
if (toEngine.length === 0 || fromEngine.length === 0) {
  // First, and not last: with an empty member list every rule below passes by
  // having no subject, and printing four `ok` lines above the failure is how a
  // reader learns to trust the wrong four lines.
  console.error(`protocol: read ${toEngine.length} ToEngine and ${fromEngine.length} FromEngine members out of ${MESSAGES} — the AST pass is aimed at nothing, and every rule below would pass on an empty list`)
  process.exit(1)
}

const rules = [pairing(toEngine, fromEngine), handlers(toEngine), receipts(fromEngine), purity(), shapePairs()]

let failed = 0
for (const check of rules) {
  const status = check.failures.length > 0 ? 'FAIL' : 'ok'
  console.log(`protocol: ${check.name} — ${status}  (${check.statement})`)
  for (const note of check.notes) console.log(`   ${note}`)
  for (const failure of check.failures) console.error(`   ${failure}`)
  if (check.failures.length > 0) failed += 1
}
console.log(`protocol: ${rules.length} rule(s), ${failed} failed`)
if (failed > 0) process.exit(1)
