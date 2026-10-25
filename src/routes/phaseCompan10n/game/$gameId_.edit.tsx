import { createFileRoute } from "@tanstack/react-router";
import { PhaseGameEditorPage } from "../../../components/GameEditor/GameEditor";

export const Route = createFileRoute("/phaseCompan10n/game/$gameId_/edit")({
  component: EditorRoute,
});

function EditorRoute() {
  const { gameId } = Route.useParams();
  return <PhaseGameEditorPage key={gameId} gameId={gameId} />;
}
