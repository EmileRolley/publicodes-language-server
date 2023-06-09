import { TextDocument } from "vscode-languageserver-textdocument";
import { LSContext } from "./context";
import Engine from "publicodes";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { parseRawPublicodesRulesFromDocument } from "./publicodesRules";
import { fileURLToPath, pathToFileURL } from "node:url";

function getPublicodeRuleFileNameFromError(e: Error) {
  const match = e.message.match(/➡️  Dans la règle "([^\n\r]*)"/);
  if (match == null) {
    return undefined;
  }
  return match[1];
}

export default async function validate(
  ctx: LSContext,
  document?: TextDocument,
  // if not already opened in the editor
  documentURI?: string
): Promise<void> {
  let diagnostics: Diagnostic[] = [];
  let errorURI: string | undefined;

  if (document == undefined && ctx.lastOpenedFile != undefined) {
    if (documentURI !== undefined) {
      document = TextDocument.create(
        documentURI,
        "publicodes",
        1,
        "(we only care about the uri)"
      );
    } else {
      document = ctx.documents.get(ctx.lastOpenedFile);
    }
  }

  if (document == undefined) throw new Error("No document to validate");

  const docFilePath = fileURLToPath(document.uri);
  ctx = parseRawPublicodesRulesFromDocument(ctx, docFilePath, document);

  try {
    ctx.connection.console.log(
      `Parsing ${Object.keys(ctx.rawPublicodesRules).length} rules`
    );
    const engine = new Engine(ctx.rawPublicodesRules);
    ctx.parsedRules = engine.getParsedRules();
    ctx.connection.console.log(
      `Validate Parsed ${Object.keys(ctx.parsedRules).length} rules`
    );
    // Remove previous diagnostics
    ctx.URIToRevalidate.delete(document.uri);
    ctx.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    if (ctx.URIToRevalidate.size > 0) {
      ctx.URIToRevalidate.forEach((uri) => {
        validate(ctx, ctx.documents.get(uri), uri);
      });
    }
  } catch (e: any) {
    const wrongRule = getPublicodeRuleFileNameFromError(e);
    errorURI =
      wrongRule !== undefined
        ? pathToFileURL(ctx.ruleToFileNameMap.get(wrongRule) ?? document.uri)
            .href
        : document.uri;
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: document.positionAt(0),
        end: document.positionAt(1),
      },
      message: e.message,
    });
  }

  errorURI = errorURI ?? document.uri;
  if (diagnostics.length > 0) {
    ctx.URIToRevalidate.add(errorURI);
  }
  console.log(
    `[validate] Sending ${diagnostics.length} diagnostics to:`,
    errorURI
  );
  ctx.connection.sendDiagnostics({
    uri: errorURI,
    diagnostics,
  });
}
