import { Plugin, Context } from "graphile-build";
import { GraphQLResolveInfo } from "graphql";
export interface GraphQLResolveInfoWithMeta extends GraphQLResolveInfo {
    graphileMeta: {};
}
export declare type OperationHookCallback<T = any, TArgs = {
    [argName: string]: any;
}> = (input: T, args: TArgs, context: any, resolveInfo: GraphQLResolveInfoWithMeta) => T | null | Promise<T | null>;
export interface OperationHookEntry<T = any> {
    priority: number;
    callback: OperationHookCallback<T>;
}
export interface OperationHook {
    before?: Array<OperationHookEntry>;
    after?: Array<OperationHookEntry>;
    error?: Array<OperationHookEntry<Error>>;
}
export declare type OperationHookGenerator = (fieldContext: Context<any>) => OperationHook;
declare const OperationHooksCorePlugin: Plugin;
export default OperationHooksCorePlugin;
