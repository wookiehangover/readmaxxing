import { ListTree } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import type { ReadingAgentStatus } from "~/hooks/use-reading-agent-status";

export function LastIncrementCard({
  increment,
}: {
  increment: ReadingAgentStatus["latestIncrement"];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest page increment</CardTitle>
        <CardDescription>
          {increment ? increment.chapterLabel : "Newest chapter bullets added by one-shot ingest"}
        </CardDescription>
        {increment ? (
          <CardAction>
            <Badge variant="outline">
              {increment.bullets.length} {increment.bullets.length === 1 ? "bullet" : "bullets"}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {increment ? (
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {increment.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListTree />
              </EmptyMedia>
              <EmptyTitle>No page increment yet</EmptyTitle>
              <EmptyDescription>A completed page with new facts will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
