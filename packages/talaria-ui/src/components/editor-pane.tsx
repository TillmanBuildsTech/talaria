// The CodeMirror editor pane (M3). Split into its own module so it can be
// dynamically imported: the editor is desktop-only, and lazy-loading keeps the
// CodeMirror bundle out of the web PWA (which only ever renders the
// desktop-only affordance, P6). Only mounted when a file is open on desktop.
import { memo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";

function languageForPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "json") return json();
  if (ext === "md" || ext === "markdown") return markdown();
  if (ext === "py") return python();
  return javascript(); // default for ts/tsx/js/jsx and anything else
}

export const EditorPane = memo(function EditorPane({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="h-full">
      <CodeMirror
        value={value}
        height="100%"
        theme="dark"
        extensions={[languageForPath(path)]}
        onChange={onChange}
        basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
      />
    </div>
  );
});
