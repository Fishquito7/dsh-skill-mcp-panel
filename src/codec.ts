/**
 * Typert strict codec 构造器 —— 一份构建同时兼容两代 harness 契约。
 *
 * 上游 commit e459e32637（perf(typert): materialize generated schemas on first use）
 * 把 strict codec 从"直接持有 schema"改成"持有 schema 工厂"：
 *
 *   - 0.1.5-rc.2 / 0.1.6-alpha.1 及更早（含当前 latest）
 *       registry / loader / gateway 读 `codec.schema`，要求 `schema.parse` 可调用。
 *   - 0.1.6-alpha.2 及以后（alpha 通道）
 *       registry / loader / gateway 读 `codec.create`，要求 `typeof create === "function"`，
 *       并在边界上执行 `codec.create().parse(value)`。
 *
 * 两代实现都只做 `typeof` 检查，且都不拒绝多余属性，因此同一个对象同时携带
 * `schema` 与 `create` 就能在两代运行时上通过 —— 不需要任何版本探测，也就不会
 * 因为版本判断失误而选错分支（注意 alpha.1 → alpha.2 之间契约就翻转过一次）。
 *
 * 兼容矩阵：
 *   | 运行时          | 校验                                   | 本构造器 |
 *   | 0.1.5-rc.2      | typeof codec.schema.parse === "function" | 通过     |
 *   | 0.1.6-alpha.1   | typeof codec.schema.parse === "function" | 通过     |
 *   | 0.1.6-alpha.2+  | typeof codec.create === "function"       | 通过     |
 *
 * 待最低支持的 harness 版本升到含该 commit 之后，可在下一个大版本移除 `schema`。
 */
export function strictCodec(typeSymbol: string, schema: any) {
  return {
    mode: "strict" as const,
    typeSymbol,
    /** 旧契约（≤ 0.1.6-alpha.1）：直接持有的 zod v4 schema。 */
    schema,
    /** 新契约（≥ 0.1.6-alpha.2）：按需物化 schema 的工厂（幂等）。 */
    create: () => schema
  };
}
