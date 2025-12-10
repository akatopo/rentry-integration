// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

import type { Ref } from './h.js';

export function CommandNotice({
  message,
  rentryUrl,
  variant = 'base',
}: {
  message: string;
  rentryUrl?: string;
  variant?: 'base' | 'error';
}) {
  const className = `notice-message-content plugin-rentry-integration ${
    variant === 'error' ? 'notice-message-content--error' : ''
  } `;
  const buttonRef: Ref = {};

  return (
    <div class={className}>
      <div class="notice-message-title">Rentry Integration</div>
      <div class="notice-message-description">{message}</div>
      {rentryUrl ? (
        <>
          <button
            $click={(e: Event) => {
              e.stopPropagation();
              window.open(rentryUrl);
            }}
          >
            View at rentry.co
          </button>
          <button
            $click={async (e: Event) => {
              e.stopPropagation();
              buttonRef.current?.removeClasses([
                'mod-destructive',
                'mod-success',
              ]);
              try {
                await navigator.clipboard.writeText(rentryUrl);
                buttonRef.current?.addClass('mod-success');
                buttonRef.current?.setText('Copied!');
              } catch (error) {
                buttonRef.current?.addClass('mod-destructive');
                buttonRef.current?.setText('Failed to copy');
              }
            }}
            ref={buttonRef}
          >
            Copy URL
          </button>
        </>
      ) : (
        ''
      )}
    </div>
  );
}
