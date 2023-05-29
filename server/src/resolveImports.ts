// @ts-nocheck

import { existsSync, readFileSync } from "fs";
import Engine from "publicodes";

const IMPORT_KEYWORD = "importer!";
const FROM_KEYWORD = "depuis";
const RULES_KEYWORD = "les règles";

const packageModelPath = (packageName, { ctx }) => {
  const modelFilePath = `${packageName}/${packageName}.model.json`;

  for (const nodeModulesPath of ctx.nodeModulesPaths) {
    const path = `${nodeModulesPath}/${modelFilePath}`;
    if (existsSync(path)) {
      return path;
    }
  }

  return `${ctx.workspaceRoot}/node_modules/${modelFilePath}`;
};

// Stores engines initialized with the rules from package
const enginesCache = {};

function getEngine(packageName, opts) {
  if (!enginesCache[packageName]) {
    if (opts?.verbose) {
      console.debug(` 📦 '${packageName}' loading`);
    }
    try {
      const path = packageModelPath(packageName, opts);

      if (opts?.verbose) {
        console.debug(` 📦 loading from '${path}'`);
      }
      const engine = new Engine(JSON.parse(readFileSync(path, "utf-8")));
      enginesCache[packageName] = engine;
    } catch (e) {
      console.error(`Error when loading '${packageName}': ${e}`);
    }
  }
  return enginesCache[packageName];
}

function getDependencies(engine, rule, acc = []) {
  const deps = Array.from(
    engine.baseContext.referencesMaps.referencesIn.get(rule.dottedName)
  ).filter(
    (depRuleName) =>
      !depRuleName.endsWith("$SITUATION") &&
      !acc.find(([accRuleName, _]) => accRuleName === depRuleName)
  );
  if (deps.length === 0) {
    return acc;
  }
  acc.push(...deps.map((dep) => [dep, engine.getRule(dep).rawNode]));
  return deps.flatMap((varName) => {
    return getDependencies(engine, engine.getRule(varName), acc);
  });
}

/**
 * Returns the rule name and its attributes.
 *
 * @param ruleToImport - An item of the `les règles` array (string | object).
 * @returns The rule name and its attributes ([string, object][1]).
 *
 * For example, for the following `importer!` rule:
 *
 * ```
 * importer!:
 *	 depuis: 'package-name'
 *	 les règles:
 *			- ruleA
 *			- ruleB:
 *			  attr1: value1
 * ```
 *
 * We have:
 * - getRuleToImportInfos('ruleA') -> [['ruleA', {}]]
 * - getRuleToImportInfos({'ruleB': {attr1: value1}) -> [['ruleA', {attr1: value1}]]
 */

function getRuleToImportInfos(ruleToImport) {
  if (typeof ruleToImport == "object") {
    const entries = Object.entries(ruleToImport);
    return entries;
  }
  return [[ruleToImport, {}]];
}

const removeRawNodeNom = (rawNode, ruleNameToCheck) => {
  const { nom, ...rest } = rawNode;
  if (nom !== ruleNameToCheck)
    throw Error(
      `Imported rule's publicode raw node "nom" attribute is different from the resolveImport script ruleName. Please investigate`
    );
  return rest;
};

export function resolveImports(rules, opts) {
  const resolvedRules = Object.entries(rules).reduce((acc, [name, value]) => {
    if (name === IMPORT_KEYWORD) {
      const engine = getEngine(value[FROM_KEYWORD], opts);
      const rulesToImport = value[RULES_KEYWORD];

      rulesToImport?.forEach((ruleToImport) => {
        const [[ruleName, attrs]] = getRuleToImportInfos(ruleToImport);
        const rule = engine.getRule(ruleName, opts);
        if (!rule) {
          throw new Error(
            `La règle '${ruleName}' n'existe pas dans ${value[FROM_KEYWORD]}`
          );
        }
        const updatedRawNode = { ...rule.rawNode, ...attrs };
        // The name "nom" will already be there as the key, also called dottedName or ruleName
        // Keeping it is a repetition and can lead to misleading translations (rule names should not be translated in the current state of translation, they're the ids)
        acc.push([ruleName, removeRawNodeNom(updatedRawNode, ruleName)]);
        const ruleDeps = getDependencies(engine, rule)
          .filter(
            ([ruleDepName, _]) =>
              // Avoid to overwrite the updatedRawNode
              !acc.find(([accRuleName, _]) => accRuleName === ruleDepName)
          )
          .map(([k, v]) => [k, removeRawNodeNom(v, k)]);
        acc.push(...ruleDeps);
      });
    } else {
      acc.push([name, value]);
    }
    return acc;
  }, []);
  return Object.fromEntries(resolvedRules);
}
