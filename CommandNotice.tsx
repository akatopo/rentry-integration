// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { h, Fragment } from './h.js';

export function CommandNotice({
  message,
  rentryUrl,
}: {
  message: string;
  rentryUrl?: string;
}) {
  return (
    <div class="notice-message-content plugin-rentry-integration">
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
