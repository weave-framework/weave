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
import InputAdornments from '../demos/ui/input-adornments';
import InputClearable from '../demos/ui/input-clearable';
import InputTypes from '../demos/ui/input-types';
import InputMultiline from '../demos/ui/input-multiline';
import InputPassword from '../demos/ui/input-password';
import InputPasswordTooltip from '../demos/ui/input-password-tooltip';
import InputStates from '../demos/ui/input-states';
import InputValidation from '../demos/ui/input-validation';
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
import StepperDemo from '../demos/ui/stepper-demo';
import PaginatorDemo from '../demos/ui/paginator-demo';
import SidenavDemo from '../demos/ui/sidenav-demo';
import MenuDemo from '../demos/ui/menu-demo';
import MenubarDemo from '../demos/ui/menubar-demo';
import ContextMenuDemo from '../demos/ui/context-menu-demo';
import TableDemo from '../demos/ui/table-demo';
import TreeDemo from '../demos/ui/tree-demo';
import BottomSheetDemo from '../demos/ui/bottom-sheet-demo';
import PopoverEditDemo from '../demos/ui/popover-edit-demo';
import AutocompleteBasic from '../demos/ui/autocomplete-basic';
import TodoApp from '../demos/examples/todo-app';
import DashboardApp from '../demos/examples/dashboard-app';
import SettingsApp from '../demos/examples/settings-app';
import WizardApp from '../demos/examples/wizard-app';
import KanbanApp from '../demos/examples/kanban-app';
import ExButtonAriaCurrent from '../demos/ui/ex-button-aria-current';
import ExButtonClass from '../demos/ui/ex-button-class';
import ExButtonContent from '../demos/ui/ex-button-content';
import ExButtonDisabled from '../demos/ui/ex-button-disabled';
import ExButtonEvents from '../demos/ui/ex-button-events';
import ExButtonType from '../demos/ui/ex-button-type';
import ExButtonVariants from '../demos/ui/ex-button-variants';
import ExCheckboxBasic from '../demos/ui/ex-checkbox-basic';
import ExCheckboxForms from '../demos/ui/ex-checkbox-forms';
import ExCheckboxName from '../demos/ui/ex-checkbox-name';
import ExCheckboxStates from '../demos/ui/ex-checkbox-states';
import ExCheckboxTristate from '../demos/ui/ex-checkbox-tristate';
import ExSelectAdornments from '../demos/ui/ex-select-adornments';
import ExSelectBasic from '../demos/ui/ex-select-basic';
import ExSelectClearable from '../demos/ui/ex-select-clearable';
import ExSelectCustom from '../demos/ui/ex-select-custom';
import ExSelectMultiple from '../demos/ui/ex-select-multiple';
import ExSelectOptions from '../demos/ui/ex-select-options';
import ExSelectPosition from '../demos/ui/ex-select-position';
import ExSelectStates from '../demos/ui/ex-select-states';
import ExSelectValidation from '../demos/ui/ex-select-validation';
import ExSliderBasic from '../demos/ui/ex-slider-basic';
import ExSliderClass from '../demos/ui/ex-slider-class';
import ExSliderControl from '../demos/ui/ex-slider-control';
import ExSliderDisabled from '../demos/ui/ex-slider-disabled';
import ExSliderFormat from '../demos/ui/ex-slider-format';
import ExSliderRange from '../demos/ui/ex-slider-range';
import ExSliderStep from '../demos/ui/ex-slider-step';
import ExSliderUncontrolled from '../demos/ui/ex-slider-uncontrolled';

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
  'ex-button-aria-current': ExButtonAriaCurrent,
  'ex-button-class': ExButtonClass,
  'ex-button-content': ExButtonContent,
  'ex-button-disabled': ExButtonDisabled,
  'ex-button-events': ExButtonEvents,
  'ex-button-type': ExButtonType,
  'ex-button-variants': ExButtonVariants,
  'ex-checkbox-basic': ExCheckboxBasic,
  'ex-checkbox-forms': ExCheckboxForms,
  'ex-checkbox-name': ExCheckboxName,
  'ex-checkbox-states': ExCheckboxStates,
  'ex-checkbox-tristate': ExCheckboxTristate,
  'ex-select-adornments': ExSelectAdornments,
  'ex-select-basic': ExSelectBasic,
  'ex-select-clearable': ExSelectClearable,
  'ex-select-custom': ExSelectCustom,
  'ex-select-multiple': ExSelectMultiple,
  'ex-select-options': ExSelectOptions,
  'ex-select-position': ExSelectPosition,
  'ex-select-states': ExSelectStates,
  'ex-select-validation': ExSelectValidation,
  'ex-slider-basic': ExSliderBasic,
  'ex-slider-class': ExSliderClass,
  'ex-slider-control': ExSliderControl,
  'ex-slider-disabled': ExSliderDisabled,
  'ex-slider-format': ExSliderFormat,
  'ex-slider-range': ExSliderRange,
  'ex-slider-step': ExSliderStep,
  'ex-slider-uncontrolled': ExSliderUncontrolled,
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
  'input-adornments': InputAdornments,
  'input-clearable': InputClearable,
  'input-types': InputTypes,
  'input-multiline': InputMultiline,
  'input-password': InputPassword,
  'input-password-tooltip': InputPasswordTooltip,
  'input-states': InputStates,
  'input-validation': InputValidation,
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
  'stepper-demo': StepperDemo,
  'paginator-demo': PaginatorDemo,
  'sidenav-demo': SidenavDemo,
  'menu-demo': MenuDemo,
  'menubar-demo': MenubarDemo,
  'context-menu-demo': ContextMenuDemo,
  'table-demo': TableDemo,
  'tree-demo': TreeDemo,
  'bottom-sheet-demo': BottomSheetDemo,
  'popover-edit-demo': PopoverEditDemo,
  'examples-todo': TodoApp,
  'examples-dashboard': DashboardApp,
  'examples-settings': SettingsApp,
  'examples-signup': WizardApp,
  'examples-kanban': KanbanApp,
};
