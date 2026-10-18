/**
 * Typert strict codec 构造器。
 *
 * 只实现 **0.2.x 起的契约**：registry / loader / gateway 一律读 `create()`
 * 工厂，并在边界上执行 `create().parse(value)`（上游 commit e459e32637 起）。
 * 早先为了同时兼容 0.1.5/0.1.6 的头两代契约，这里额外挂过一个 `schema` 字段；
 * 2026-10-18 起本插件的最低支持宿主是 **0.2.0**，历史包袱已删除。
 *
 * 约定：`create()` 必须幂等（宿主用 `record.value ??= create()` 缓存）。
 */
export function strictCodec(typeSymbol: string, schema: any) {
  return {
    mode: "strict" as const,
    typeSymbol,
    /** 按需物化 schema 的工厂（幂等）。0.2.x 起宿主的唯一契约。 */
    create: () => schema
  };
}
