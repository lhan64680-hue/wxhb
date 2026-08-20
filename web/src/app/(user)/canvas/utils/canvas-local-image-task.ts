export type LocalImageTaskCheck = {
    hasContent: boolean;
    isLocalTransport: boolean;
    isRestoring: boolean;
    progress?: number;
    status?: string;
};

/**
 * A local GRS request is owned by the browser that started it. The task can
 * only be declared stale while restoring a saved canvas, never by its normal
 * in-page polling loop.
 */
export function shouldStopLocalImageTaskWithoutResult({ hasContent, isLocalTransport, isRestoring, status }: LocalImageTaskCheck) {
    return isRestoring && isLocalTransport && status === "loading" && !hasContent;
}
