function hasBotMethodCall(node, methodName) {
  return node?.type === 'CallExpression'
    && node.callee?.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.object?.type === 'Identifier'
    && node.callee.object.name === 'bot'
    && node.callee.property?.type === 'Identifier'
    && node.callee.property.name === methodName;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
      continue;
    }
    if (value && typeof value === 'object' && value.type) {
      walk(value, visit);
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
    function checkHandler(handlerNode) {
      if (!handlerNode || (handlerNode.type !== 'FunctionExpression' && handlerNode.type !== 'ArrowFunctionExpression')) {
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
      CallExpression(node) {
        if (!hasBotMethodCall(node, 'on') && !hasBotMethodCall(node, 'use')) return;

        const handler = node.arguments[1] || node.arguments[0];
        checkHandler(handler);
      },
    };
  },
};
