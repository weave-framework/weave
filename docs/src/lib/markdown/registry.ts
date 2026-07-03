import type { Component } from '@weave-framework/runtime/dom';
import CounterDemo from '../demos/counter-demo';
import ButtonEvents from '../demos/ui/button-events';
import ButtonVariants from '../demos/ui/button-variants';
import ButtonDisabled from '../demos/ui/button-disabled';
import ButtonConfirm from '../demos/ui/button-confirm';
import IconBasic from '../demos/ui/icon-basic';
import IconColor from '../demos/ui/icon-color';
import BadgeVariants from '../demos/ui/badge-variants';
import BadgeMax from '../demos/ui/badge-max';
import CardBasic from '../demos/ui/card-basic';
import CardInteractive from '../demos/ui/card-interactive';
import ButtonToggleSingle from '../demos/ui/button-toggle-single';
import ButtonToggleMulti from '../demos/ui/button-toggle-multi';
import ToolbarBasic from '../demos/ui/toolbar-basic';
import RippleBasic from '../demos/ui/ripple-basic';
import DividerBasic from '../demos/ui/divider-basic';
import InputBasic from '../demos/ui/input-basic';
import InputFeatures from '../demos/ui/input-features';
import CheckboxBasic from '../demos/ui/checkbox-basic';
import CheckboxTristate from '../demos/ui/checkbox-tristate';
import RadioBasic from '../demos/ui/radio-basic';
import SlideToggleBasic from '../demos/ui/slide-toggle-basic';
import FormFieldBasic from '../demos/ui/form-field-basic';
import FormFieldError from '../demos/ui/form-field-error';
import SelectBasic from '../demos/ui/select-basic';
import SelectMultiple from '../demos/ui/select-multiple';
import ChipsBasic from '../demos/ui/chips-basic';
import SliderBasic from '../demos/ui/slider-basic';
import DatepickerBasic from '../demos/ui/datepicker-basic';
import TimepickerBasic from '../demos/ui/timepicker-basic';
import ProgressBarDemo from '../demos/ui/progress-bar-demo';
import ProgressSpinnerDemo from '../demos/ui/progress-spinner-demo';
import TooltipDemo from '../demos/ui/tooltip-demo';
import DialogDemo from '../demos/ui/dialog-demo';
import SnackbarDemo from '../demos/ui/snackbar-demo';
import TabsDemo from '../demos/ui/tabs-demo';
import ExpansionDemo from '../demos/ui/expansion-demo';
import ListDemo from '../demos/ui/list-demo';
import GridListDemo from '../demos/ui/grid-list-demo';
import AutocompleteBasic from '../demos/ui/autocomplete-basic';

/**
 * Live-demo registry: maps a `:::demo <key>` directive to a real Weave component.
 * The renderer instantiates the component so the example actually runs on the page.
 * Add a demo here and reference it by key from any markdown page.
 *
 * UI-library demos (keys prefixed by component name) import the real
 * `@weave-framework/ui/<component>` and use it exactly as a consumer would.
 */
export const demos: Record<string, Component> = {
  counter: CounterDemo,
  'button-events': ButtonEvents,
  'button-variants': ButtonVariants,
  'button-disabled': ButtonDisabled,
  'button-confirm': ButtonConfirm,
  'icon-basic': IconBasic,
  'icon-color': IconColor,
  'badge-variants': BadgeVariants,
  'badge-max': BadgeMax,
  'card-basic': CardBasic,
  'card-interactive': CardInteractive,
  'button-toggle-single': ButtonToggleSingle,
  'button-toggle-multi': ButtonToggleMulti,
  'toolbar-basic': ToolbarBasic,
  'ripple-basic': RippleBasic,
  'divider-basic': DividerBasic,
  'input-basic': InputBasic,
  'input-features': InputFeatures,
  'checkbox-basic': CheckboxBasic,
  'checkbox-tristate': CheckboxTristate,
  'radio-basic': RadioBasic,
  'slide-toggle-basic': SlideToggleBasic,
  'form-field-basic': FormFieldBasic,
  'form-field-error': FormFieldError,
  'select-basic': SelectBasic,
  'select-multiple': SelectMultiple,
  'chips-basic': ChipsBasic,
  'slider-basic': SliderBasic,
  'autocomplete-basic': AutocompleteBasic,
  'datepicker-basic': DatepickerBasic,
  'timepicker-basic': TimepickerBasic,
  'progress-bar-demo': ProgressBarDemo,
  'progress-spinner-demo': ProgressSpinnerDemo,
  'tooltip-demo': TooltipDemo,
  'dialog-demo': DialogDemo,
  'snackbar-demo': SnackbarDemo,
  'tabs-demo': TabsDemo,
  'expansion-demo': ExpansionDemo,
  'list-demo': ListDemo,
  'grid-list-demo': GridListDemo,
};
