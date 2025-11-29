// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

const spinner = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="svg-icon"
  >
    <path d="m 15.174668,3.5621906 a 9.013958,9.0154591 0 0 1 5.82565,7.9420234" />
  </svg>
);

export function StatusBarSpinner({ label }: { label: string }) {
  return (
    <>
      <span class="status-bar-item-icon status-bar-item-segment">
        {spinner}
      </span>
      <span class="status-bar-item-segment">{label}</span>
    </>
  );
}
