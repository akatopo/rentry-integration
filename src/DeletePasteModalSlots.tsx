// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

export function Content({ filename }: { filename: string }) {
  return (
    <p class="u-break-word">
      Are you sure you want to delete the paste for “{filename}”?
    </p>
  );
}

export function Buttons({
  confirmHandler,
  cancelHandler,
}: {
  confirmHandler: (...args: never) => unknown;
  cancelHandler: (...args: never) => unknown;
}) {
  return (
    <>
      <button class="mod-warning" $click={confirmHandler}>
        Delete
      </button>
      <button class="mod-cancel" $click={cancelHandler}>
        Cancel
      </button>
    </>
  );
}
