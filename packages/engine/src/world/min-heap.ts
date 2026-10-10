/** Binary min-heap with a caller-supplied ordering. Its backing array is exposed through
 * `toArray()` / `fromArray()` so world checkpoints can serialize pending work (R7). */
export class MinHeap<T> {
  private items: T[] = [];

  constructor(private readonly before: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  peek(): T | undefined {
    return this.items[0];
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && this.before(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && this.before(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }

  toArray(): T[] {
    return [...this.items];
  }

  /** Rebuilds from a previously serialized array (any order is valid input). */
  static fromArray<T>(items: readonly T[], before: (a: T, b: T) => boolean): MinHeap<T> {
    const heap = new MinHeap<T>(before);
    for (const item of items) heap.push(item);
    return heap;
  }
}
