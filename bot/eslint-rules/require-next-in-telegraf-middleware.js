function hasBotMethodCall(node, methodName) {
  return node?.type === 'CallExpression'
    && node.callee?.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.object?.type === 'Identifier'
    && node.callee.object.name === 'bot'
    && node.callee.property?.type === 'Identifier'
    && node.callee.property.name === methodName;
}

function isFunctionNode(node) {
  return node?.type === 'FunctionDeclaration'
    || node?.type === 'FunctionExpression'
    || node?.type === 'ArrowFunctionExpression';
}

function walk(node, visit, seen = new Set()) {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  visit(node);

  for (const key of Object.keys(node)) {
    // Skip the AST back-reference; following it climbs back up the tree and
    // recurses infinitely (stack overflow).
    if (key === 'parent') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, seen);
      continue;
    }
    if (value && typeof value === 'object' && value.type) {
      walk(value, visit, seen);
    }
  }
}

function functionCallsIdentifier(fnNode, identifierName) {
  let found = false;
  walk(fnNode.body, (node) => {
    if (found) return;
    if (node.type !== 'CallExpression') return;
    if (node.callee?.type === 'Identifier' && node.callee.name === identifierName) {
      found = true;
    }
  });
  return found;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require forwarding with next() in Telegraf bot.on/bot.use middleware handlers',
    },
    schema: [],
    messages: {
      missingNextParam: 'Telegraf middleware handler should accept (ctx, next) to avoid swallowing later handlers.',
      missingNextCall: 'Telegraf middleware handler accepts next but never calls next(). This can block downstream handlers.',
    },
  },
  create(context) {
    // Handlers are now often passed by reference (e.g. `bot.on('text', h.onText)`)
    // after being extracted into named functions by the createHandlers() factory.
    // Collect every locally-defined function by name so we can resolve those
    // references back to their definition and still lint them.
    const functionsByName = new Map();
    const pendingHandlers = [];

    function recordFunction(name, fnNode) {
      if (name && fnNode && !functionsByName.has(name)) {
        functionsByName.set(name, fnNode);
      }
    }

    function resolveHandler(handlerNode) {
      if (!handlerNode) return null;
      if (isFunctionNode(handlerNode)) {
        return handlerNode;
      }
      // `bot.on('text', h.onText)` — resolve by the member's property name.
      if (handlerNode.type === 'MemberExpression' && !handlerNode.computed && handlerNode.property?.type === 'Identifier') {
        return functionsByName.get(handlerNode.property.name) || null;
      }
      // `bot.on('text', onText)` — resolve by the identifier name.
      if (handlerNode.type === 'Identifier') {
        return functionsByName.get(handlerNode.name) || null;
      }
      return null;
    }

    function checkHandler(handlerNode) {
      if (!isFunctionNode(handlerNode)) {
        return;
      }

      if (handlerNode.params.length < 2) {
        context.report({ node: handlerNode, messageId: 'missingNextParam' });
        return;
      }

      const nextParam = handlerNode.params[1];
      if (nextParam.type !== 'Identifier') return;

      if (!functionCallsIdentifier(handlerNode, nextParam.name)) {
        context.report({ node: handlerNode, messageId: 'missingNextCall' });
      }
    }

    return {
      FunctionDeclaration(node) {
        recordFunction(node.id?.name, node);
      },
      VariableDeclarator(node) {
        if (node.id?.type === 'Identifier'
          && (node.init?.type === 'ArrowFunctionExpression' || node.init?.type === 'FunctionExpression')) {
          recordFunction(node.id.name, node.init);
        }
      },
      CallExpression(node) {
        if (!hasBotMethodCall(node, 'on') && !hasBotMethodCall(node, 'use')) return;

        // Defer the check until Program:exit so the handler reference can be
        // resolved even when the function is defined later in the file.
        pendingHandlers.push(node.arguments[1] || node.arguments[0]);
      },
      'Program:exit'() {
        for (const handler of pendingHandlers) {
          // Only lint handlers we can resolve to a local function. Unresolved
          // references (e.g. imported middleware) are skipped to avoid false positives.
          const resolved = resolveHandler(handler);
          if (resolved) checkHandler(resolved);
        }
      },
    };
  },
};
