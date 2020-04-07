import { Plugin, Context } from "graphile-build";
import {
  GraphQLResolveInfo,
  GraphQLFieldResolver,
  GraphQLObjectType,
} from "graphql";

const FINALLY: any = Symbol("finally");

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
  resolveInfo: GraphQLResolveInfoWithMeta
) => T | null | Promise<T | null>;

export interface OperationHookEntry<T = any> {
  priority: number;
  callback: OperationHookCallback<T>;
}

export interface OperationHook {
  before?: Array<OperationHookEntry>;
  after?: Array<OperationHookEntry>;
  error?: Array<OperationHookEntry<Error>>;
  finally?: Array<OperationHookEntry<typeof FINALLY>>;
}

export type OperationHookGenerator = (
  fieldContext: Context<any>
) => OperationHook;

const FINALLY = Symbol("finally");

// Hooks are applied one after the other, in an asynchronous chain.
async function applyHooks<T, TArgs>(
  hooks: OperationHookCallback[],
  input: T,
  args: TArgs,
  context: any,
  resolveInfo: GraphQLResolveInfoWithMeta,
  skipErrors = false
): Promise<T | null> {
  let output: T | null = input;
  for (const hook of hooks) {
    try {
      output = await hook(output, args, context, resolveInfo);

      if (input === FINALLY && output !== FINALLY) {
        throw new Error(
          "Logic error: 'cleanup' hook must return the input value."
        );
      }

      if (output === undefined && input !== undefined) {
        throw new Error("Logic error: operation hook returned 'undefined'.");
      }
    } catch (e) {
      if (!skipErrors) {
        throw e;
      } else {
        console.error(e);
      }
    }
  }
  return output;
}

function hookSort(a: OperationHookEntry, b: OperationHookEntry): number {
  return a.priority - b.priority;
}

export type AddOperationHookFn = (fn: OperationHookGenerator) => void;
type GetOperationHooksCallbackForContextFn = (
  context: Context<any>
) => null | {
  before: OperationHookCallback[];
  after: OperationHookCallback[];
  error: OperationHookCallback<Error>[];
  finally: OperationHookCallback<typeof FINALLY>[];
};

const OperationHooksCorePlugin: Plugin = function OperationHooksCorePlugin(
  builder
) {
  builder.hook("build", (build) => {
    const _operationHookGenerators: OperationHookGenerator[] = [];
    let locked = false;
    const addOperationHook: AddOperationHookFn = (fn) => {
      if (locked) {
        throw new Error(
          "Attempted to register operation hook after a hook was applied; this indicates an issue with the ordering of your plugins. Ensure that the OperationHooksPlugin and anything that depends on it come at the end of the plugins list."
        );
      }
      _operationHookGenerators.push(fn);
    };

    const _getOperationHookCallbacksForContext: GetOperationHooksCallbackForContextFn = (
      context
    ) => {
      // Don't allow any more hooks to be registered now that one is being applied.
      locked = true;

      // Generate the hooks, and aggregate into before/after/error arrays
      const generatedHooks: OperationHook[] = _operationHookGenerators
        .map((gen) => gen(context))
        .filter((_) => _);
      const before: OperationHookEntry[] = [];
      const after: OperationHookEntry[] = [];
      const error: OperationHookEntry<Error>[] = [];
      const finallyHooks: OperationHookEntry<typeof FINALLY>[] = [];
      generatedHooks.forEach((oneHook) => {
        if (oneHook.before) {
          before.push(...oneHook.before);
        }
        if (oneHook.after) {
          after.push(...oneHook.after);
        }
        if (oneHook.error) {
          error.push(...oneHook.error);
        }
        if (oneHook.finally) {
          finallyHooks.push(...oneHook.finally);
        }
      });

      // No relevant hooks, don't bother wrapping the resolver
      if (
        before.length === 0 &&
        after.length === 0 &&
        error.length === 0 &&
        finallyHooks.length === 0
      ) {
        return null;
      }

      // Sort the hooks based on their priority (remember sort() mutates the arrays)
      before.sort(hookSort);
      after.sort(hookSort);
      error.sort(hookSort);
      finallyHooks.sort(hookSort);

      // Return the relevant callbacks
      return {
        before: before.map((hook) => hook.callback),
        after: after.map((hook) => hook.callback),
        error: error.map((hook) => hook.callback),
        finally: finallyHooks.map((hook) => hook.callback),
      };
    };
    return build.extend(build, {
      addOperationHook,
      _getOperationHookCallbacksForContext,
    });
  });

  builder.hook("GraphQLObjectType:fields:field", (field, build, context) => {
    const _getOperationHookCallbacksForContext: GetOperationHooksCallbackForContextFn =
      build._getOperationHookCallbacksForContext;
    const {
      Self,
      scope: { fieldName, isRootQuery, isRootMutation, isRootSubscription },
    } = context;

    // We only care about root fields
    if (!isRootQuery && !isRootMutation && !isRootSubscription) {
      return field;
    }

    // Get the hook for this context
    const callbacks = _getOperationHookCallbacksForContext(context);
    if (!callbacks) {
      return field;
    }

    // Get the old resolver for us to wrap
    const oldResolve = field.resolve;
    if (!oldResolve) {
      throw new Error(
        `Default resolver found for field ${Self.name}.${fieldName}; default resolvers at the root level are not supported by operation-hooks`
      );
    }

    const resolve: GraphQLFieldResolver<any, any> = async function (
      op,
      args,
      context,
      resolveInfo
    ) {
      const resolveInfoWithMeta: GraphQLResolveInfoWithMeta = {
        ...resolveInfo,
        graphileMeta: {},
      };

      try {
        const symbol = Symbol("before");
        // Perform the 'before' hooks
        const beforeResult = await applyHooks(
          callbacks.before,
          symbol,
          args,
          context,
          resolveInfoWithMeta
        );

        // Exit early if someone changed the result
        if (beforeResult !== symbol) {
          return beforeResult;
        }

        // Call the old resolver
        const result = await oldResolve(op, args, context, resolveInfoWithMeta);

        // Perform the 'after' hooks
        const afterResult = await applyHooks(
          callbacks.after,
          result,
          args,
          context,
          resolveInfoWithMeta
        );
        return afterResult;
      } catch (error) {
        // An error occured, call the 'error' hooks
        const errorResult = await applyHooks(
          callbacks.error,
          error,
          args,
          context,
          resolveInfoWithMeta
        );
        throw errorResult;
      } finally {
        await applyHooks(
          callbacks.finally,
          FINALLY,
          args,
          context,
          resolveInfoWithMeta,
          true
        );
      }
    };
    resolve["__asyncHooks"] = true;

    // Finally override the resolve method
    return {
      ...field,
      resolve,
    };
  });

  // Ensure all the resolvers have been wrapped (i.e. sanity check)
  builder.hook("finalize", (schema) => {
    const missingHooks: String[] = [];
    const types = [
      schema.getQueryType(),
      schema.getMutationType(),
      schema.getSubscriptionType(),
    ].filter((_) => _);
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

export default OperationHooksCorePlugin;
