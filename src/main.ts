import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { appConfig } from './app/app.config';
import { DrawingBoard } from './app/drawing-board/drawing-board';

/**
 * Bootstraps an Angular application context and registers the drawing board
 * as a native custom element (`<drawing-board>`), so it can be dropped into
 * ANY host page — Angular, React, or plain HTML — as a standards-based web
 * component.
 */
createApplication(appConfig)
  .then((appRef) => {
    if (!customElements.get('drawing-board')) {
      const element = createCustomElement(DrawingBoard, {
        injector: appRef.injector,
      });
      customElements.define('drawing-board', element);
    }
  })
  .catch((err) => console.error(err));
