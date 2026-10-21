/** Asks for a run `delay` ms from now; a pending earlier run is kept. */
export type Schedule = (delay?: number) => void;

// The earliest request wins, so constant X re-renders cannot postpone a run forever (a trailing debounce would).
export function createScheduler(run: () => void, defaultDelay: number): Schedule {
  let timer: number | undefined;
  let dueAt = 0;
  return (delay = defaultDelay) => {
    const at = Date.now() + delay;
    if (timer !== undefined && dueAt <= at) return;
    window.clearTimeout(timer);
    dueAt = at;
    timer = window.setTimeout(() => {
      timer = undefined;
      run();
    }, delay);
  };
}
