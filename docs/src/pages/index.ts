import { navigate } from '@weave-framework/router';
import Button from '@weave-framework/ui/button';
import Card from '@weave-framework/ui/card';

// Capitalized tags in index.html resolve to these imports.
void Button;
void Card;

interface HomeSetup {
  /** Navigate to the Learn intro (primary CTA). */
  goStarted: () => void;
  /** Navigate to the API reference (secondary CTA). */
  goReference: () => void;
  /** Open the repository in a new tab. */
  openRepo: () => void;
}

const repoUrl = 'https://github.com/weave-framework/weave';

/** The docs landing page (route `/`). */
export function setup(): HomeSetup {
  return {
    goStarted: () => navigate('/learn/introduction'),
    goReference: () => navigate('/reference/runtime'),
    openRepo: () => window.open(repoUrl, '_blank', 'noopener,noreferrer'),
  };
}
