import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { appConfig } from './app/app.config';
import { ArtistBoard } from './app/artist-board/artist-board';

/**
 * Bootstraps an Angular application context and registers the artist board
 * as a native custom element (`<artist-board>`), so it can be dropped into
 * ANY host page — Angular, React, or plain HTML — as a standards-based web
 * component.
 */
createApplication(appConfig)
  .then((appRef) => {
    if (!customElements.get('artist-board')) {
      const element = createCustomElement(ArtistBoard, {
        injector: appRef.injector,
      });
      customElements.define('artist-board', element);
    }
  })
  .catch((err) => console.error(err));
