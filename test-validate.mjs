import { validateFrontmatter } from "./lib/skill-files.js";

let failures = 0;
const check = (label, cond) => {
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
  if (!cond) failures++;
};

// valid basics
check("plain frontmatter ok", validateFrontmatter("---\nname: my-skill\ndescription: 你好\n---\nbody").ok);
// real-YAML features our old regex validator could not handle
check("folded multiline description ok", validateFrontmatter("---\nname: my-skill\ndescription: >-\n  第一行\n  第二行\n---\nbody").ok);
check("quoted value with colon ok", validateFrontmatter('---\nname: my-skill\ndescription: "包含:冒号"\n---\nbody').ok);
// YAML-invalid content the old regex validator would have accepted
check("unquoted colon in scalar rejected", !validateFrontmatter("---\nname: my-skill\ndescription: 包含: 冒号\n---\nbody").ok);
check("invalid yaml indentation rejected", !validateFrontmatter("---\nname: my-skill\ndescription: 好\n\tbad: tab\n---\nbody").ok);
// field policy
check("missing name rejected", !validateFrontmatter("---\ndescription: 好\n---\nbody").ok);
check("bad name grammar rejected", !validateFrontmatter("---\nname: My_Skill!\ndescription: 好\n---\nbody").ok);
check("missing description rejected", !validateFrontmatter("---\nname: my-skill\n---\nbody").ok);
check("legacy key rejected", !validateFrontmatter("---\nname: my-skill\ndescription: 好\ndisableModelInvocation: true\n---\nbody").ok);
check("bad bool rejected", !validateFrontmatter("---\nname: my-skill\ndescription: 好\nuser-invocable: maybe\n---\nbody").ok);
check("metadata non-object rejected", !validateFrontmatter("---\nname: my-skill\ndescription: 好\nmetadata: xyz\n---\nbody").ok);
check("metadata object ok", validateFrontmatter("---\nname: my-skill\ndescription: 好\nmetadata:\n  a: 1\n---\nbody").ok);

console.log(failures === 0 ? "ALL VALIDATOR TESTS PASSED" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
