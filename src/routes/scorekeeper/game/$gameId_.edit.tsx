import { createFileRoute } from "@tanstack/react-router";
import { GenericGameEditorPage } from "../../../components/GameEditor/GameEditor";

export const Route = createFileRoute("/scorekeeper/game/$gameId_/edit")({
  component: EditorRoute,
});

function EditorRoute() {
  const { gameId } = Route.useParams();
  return <GenericGameEditorPage key={gameId} gameId={gameId} />;
}
