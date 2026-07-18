import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button.js";

interface PaginationProps {
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  loading?: boolean;
}

export function Pagination({ hasNext, hasPrevious, onNext, onPrevious, loading }: PaginationProps) {
  return (
    <div className="flex items-center justify-end gap-2 pt-4">
      <Button
        variant="secondary"
        onClick={onPrevious}
        disabled={!hasPrevious || loading}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        Previous
      </Button>
      <Button variant="secondary" onClick={onNext} disabled={!hasNext || loading} aria-label="Next page">
        Next
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
