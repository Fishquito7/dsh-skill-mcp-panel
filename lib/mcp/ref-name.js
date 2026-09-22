/**
 * dsh-skill-mcp-panel —— 凭证引用名的文法与派生（纯函数，零依赖）。
 *
 * 引用名（CredentialRef）的官方定义在 @deepseek-ai/dsh-credentials：一个
 * POSIX shell 标识符，例如 `DEEPSEEK_API_KEY`。本模块镜像那条文法，供两处
 * 离线的写盘路径（工作区文件校验、CLI）使用；真正落盘/解析时仍由官方
 * `credentialRef()` 品牌化，官方实现是最终裁判。
 *
 * MCP 的 env 键名通常本身就是合法的引用名，可以直接当引用用；HTTP header
 * 名则常常不合文法（`X-Api-Key` 带连字符），所以需要把 header 名派生成一个
 * 合法引用名，并把映射显式记进工作区文件（可审计、可手改）。
 */
/** 与 `credentialRef` 一致的引用名文法：POSIX shell 标识符。 */
export const CREDENTIAL_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 该字符串能否作为凭证引用名。 */
export function isReferenceName(value) {
    return typeof value === "string" && CREDENTIAL_REF_RE.test(value);
}
/** 把任意片段归一为可放进引用名的形态（大写、非字母数字转下划线）。 */
function normalizeSegment(value) {
    return value.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}
/**
 * 给一个 HTTP header 派生稳定的引用名：`MCP_<SERVER>_<HEADER>`。
 *
 * 例：serverName `remote`，header `X-Api-Key` → `MCP_REMOTE_X_API_KEY`。
 * 派生结果一定满足 {@link CREDENTIAL_REF_RE}。
 */
export function headerRefName(serverName, headerName) {
    const name = "MCP_" + normalizeSegment(serverName) + "_" + normalizeSegment(headerName);
    // 归一后仍可能以下划线开头（原片段以非字母数字开头），补一个字母前缀。
    return CREDENTIAL_REF_RE.test(name) ? name : "REF_" + name;
}
