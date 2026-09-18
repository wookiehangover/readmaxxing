import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  OUTLINE_MAX_FAILURES,
  OUTLINE_QUALITY_THRESHOLD,
  OUTLINE_RETRY_QUALITY_THRESHOLD,
  type OutlineBulletRating,
} from "~/lib/reading-agent/outline-quality";

export function OutlineQualityCard({ ratings }: { ratings: OutlineBulletRating[] | undefined }) {
  if (!ratings?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest bullet quality checks</CardTitle>
        <CardDescription>
          Jev requires at least {Math.round(OUTLINE_QUALITY_THRESHOLD * 100)}% on every dimension on
          the first attempt and {Math.round(OUTLINE_RETRY_QUALITY_THRESHOLD * 100)}% on retries.
          Bullets that fail {OUTLINE_MAX_FAILURES} checks are omitted. Scores are model judgments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bullet / attempt</TableHead>
              <TableHead>Relevance</TableHead>
              <TableHead>Accuracy</TableHead>
              <TableHead>Consistency</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ratings.map((rating, index) => (
              <TableRow key={index}>
                <TableCell className="max-w-96 whitespace-normal">
                  {rating.bullet}
                  <div className="text-xs text-muted-foreground">Attempt {rating.attempt}</div>
                </TableCell>
                <TableCell>{Math.round(rating.relevance * 100)}%</TableCell>
                <TableCell>{Math.round(rating.accuracy * 100)}%</TableCell>
                <TableCell>{Math.round(rating.consistency * 100)}%</TableCell>
                <TableCell>{Math.round(rating.rating * 100)}%</TableCell>
                <TableCell>
                  <Badge variant={rating.accepted ? "outline" : "destructive"}>
                    {rating.accepted ? "Passed" : "Failed"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
