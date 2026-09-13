import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";

export function App(): React.JSX.Element {
  return (
    <main>
      <h1>POS Local</h1>
      <StatusPanel />
      <SalePanel />
      <ReceiptPanel />
      <OperationPanel />
    </main>
  );
}
