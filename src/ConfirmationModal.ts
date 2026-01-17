import { App, Modal } from 'obsidian';
import { ModalButtonContainer } from './ModalButtonContainer.js';

export type ConfirmationModalRes = 'confirm' | 'cancel';

export type ButtonsRenderFunc = ({
  confirmHandler,
  cancelHandler,
}: {
  confirmHandler: (...args: never) => unknown;
  cancelHandler: (...args: never) => unknown;
}) => DocumentFragment;

export class ConfirmationModal extends Modal {
  constructor(
    app: App,
    {
      onSubmit = () => {},
      title,
      content,
      buttons,
    }: {
      onSubmit?: (result: ConfirmationModalRes) => void;
      content: () => DocumentFragment;
      buttons: ButtonsRenderFunc;
      title: string;
    },
  ) {
    super(app);
    this.setTitle(title);

    this.contentEl.append(content());

    const buttonContainerEl = ModalButtonContainer();
    buttonContainerEl.append(
      buttons({
        cancelHandler: () => {
          onSubmit('cancel');
        },
        confirmHandler: () => {
          onSubmit('confirm');
        },
      }),
    );
    this.modalEl.append(buttonContainerEl);
  }
}
