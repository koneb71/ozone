import { Navigate, createFileRoute } from "@tanstack/react-router";

// A copied thread link.
export const Route = createFileRoute("/threads/$environmentId/$threadId")({
  component: function ThreadLinkRedirect() {
    const params = Route.useParams();
    return <Navigate to="/$environmentId/$threadId" params={params} search replace />;
  },
});
