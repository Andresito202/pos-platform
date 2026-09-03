import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";

export function App(): React.JSX.Element {
  return (
    <main>
      <h1>POS Local</h1>
      <StatusPanel />
      <OperationPanel />
    </main>
  );
}
