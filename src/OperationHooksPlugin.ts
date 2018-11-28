import { Plugin, Context } from "graphile-build";
import {
  GraphQLResolveInfo,
  GraphQLFieldResolver,
  GraphQLObjectType,
} from "graphql";

export interface GraphQLResolveInfoWithMeta extends GraphQLResolveInfo {
  graphileMeta: {};
}

export type OperationHookCallback<
  T = any,
  TArgs = { [argName: string]: any }
> = (
  input: T,
  args: TArgs,
  context: any,
  resolveInfo: GraphQLResolveInfo
) => T | null | Promise<T | null>;

export interface OperationHookEntry<T = any> {
  priority: number;
  callback: OperationHookCallback<T>;
}

export interface OperationHook {
  before?: Array<OperationHookEntry>;
  after?: Array<OperationHookEntry>;
  error?: Array<OperationHookEntry<Error>>;
}

export type OperationHookGenerator = (
  fieldContext: Context<any>
) => OperationHook;

function getCallbacksForContext(
  hookGenerators: OperationHookGenerator[],
  context: Context<any>
): null | {
  before: OperationHookCallback[];
  after: OperationHookCallback[];
  error: OperationHookCallback<Error>[];
} {
  const allHooks: OperationHook[] = hookGenerators
    .map(gen => gen(context))
    .filter(_ => _);
  const before: OperationHookEntry[] = [];
  const after: OperationHookEntry[] = [];
  const error: OperationHookEntry<Error>[] = [];
  allHooks.forEach(oneHook => {
    if (oneHook.before) {
      before.push(...oneHook.before);
    }
    if (oneHook.after) {
      after.push(...oneHook.after);
    }
    if (oneHook.error) {
      error.push(...oneHook.error);
    }
  });
  if (before!.length === 0 && after!.length === 0 && error!.length === 0) {
    return null;
  }
  // Now sort them
  return {
    before: before.map(hook => hook.callback),
    after: after.map(hook => hook.callback),
    error: error.map(hook => hook.callback),
  };
}

async function applyHooks<T, TArgs>(
  hooks: OperationHookCallback[],
  input: T,
  args: TArgs,
  context: any,
  resolveInfo: GraphQLResolveInfoWithMeta
): Promise<T | null> {
  let output: T | null = input;
  for (const hook of hooks) {
    output = await hook(output, args, context, resolveInfo);
    // Nulls return early
    if (output === null) {
      return null;
    }
    if (output === undefined) {
      throw new Error("Logic error: operation hook returned 'undefined'.");
    }
  }
  return output;
}

const OperationHooksPlugin: Plugin = function OperationHooksPlugin(builder) {
  builder.hook("build", build => {
    const _operationHookGenerators: OperationHookGenerator[] = [];
    return build.extend(build, {
      _operationHookGenerators,
      addOperationHook(fn: OperationHookGenerator) {
        _operationHookGenerators.push(fn);
      },
    });
  });

  builder.hook("GraphQLObjectType:fields:field", (field, build, context) => {
    const { _operationHookGenerators } = build;
    const {
      Self,
      scope: { fieldName, isRootQuery, isRootMutation, isRootSubscription },
    } = context;

    // We only care about root fields
    if (!isRootQuery && !isRootMutation && !isRootSubscription) {
      return field;
    }

    // Get the hook for this context
    const callbacks = getCallbacksForContext(_operationHookGenerators, context);
    if (!callbacks) {
      return field;
    }

    // Get the old resolver for us to wrap
    const oldResolve = field.resolve;
    if (!oldResolve) {
      throw new Error(
        `Default resolver found for field ${
          Self.name
        }.${fieldName}; default resolvers at the root level are not supported by operation-hooks`
      );
    }

    const resolve: GraphQLFieldResolver<any, any> = async function(
      op,
      args,
      context,
      resolveInfo: GraphQLResolveInfoWithMeta
    ) {
      // Mutating for performance reasons
      resolveInfo.graphileMeta = {};

      try {
        const symbol = Symbol("before");
        // Perform the 'before' hooks
        const beforeResult = await applyHooks(
          callbacks.before,
          symbol,
          args,
          context,
          resolveInfo
        );

        // Exit early if someone changed the result
        if (beforeResult !== symbol) {
          return beforeResult;
        }

        // Call the old resolver
        const result = await oldResolve(op, args, context, resolveInfo);

        // Perform the 'after' hooks
        const afterResult = await applyHooks(
          callbacks.after,
          result,
          args,
          context,
          resolveInfo
        );
        return afterResult;
      } catch (error) {
        // An error occured, call the 'error' hooks
        const errorResult = await applyHooks(
          callbacks.error,
          error,
          args,
          context,
          resolveInfo
        );
        throw errorResult;
      }
    };
    resolve["__asyncHooks"] = true;

    return {
      ...field,
      resolve,
    };
  });

  builder.hook("finalize", schema => {
    // Ensure all the resolvers have been wrapped (i.e. sanity check)
    const types = [
      schema.getQueryType(),
      schema.getMutationType(),
      schema.getSubscriptionType(),
    ].filter(_ => _);
    const missingHooks: String[] = [];
    types.forEach((type: GraphQLObjectType) => {
      const fields = type.getFields();
      for (const field of Object.values(fields)) {
        const { resolve } = field;
        if (!resolve || !resolve["__asyncHooks"]) {
          missingHooks.push(`${type.name}.${field.name}`);
        }
      }
    });
    if (missingHooks.length) {
      throw new Error(
        `Schema validation error: operation hooks were not added to the following fields: ${missingHooks.join(
          ", "
        )}`
      );
    }

    return schema;
  });
};

export default OperationHooksPlugin;
