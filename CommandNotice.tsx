// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

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
  return (
    <div class={className}>
      <div class="notice-message-title">Rentry Integration</div>
      <div class="notice-message-description">{message}</div>
      {rentryUrl ? (
        <button
          $click={(e: Event) => {
            e.stopPropagation();
            window.open(rentryUrl);
          }}
        >
          View at rentry.co
        </button>
      ) : (
        ''
      )}
    </div>
  );
}
