// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

import { getIcon } from 'obsidian';

export function StatusBarSpinner({ label }: { label: string }) {
  return (
    <>
      <span class="status-bar-item-icon status-bar-item-segment">
        {getIcon('loader-circle')}
      </span>
      <span class="status-bar-item-segment">{label}</span>
    </>
  );
}
