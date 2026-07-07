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
import ExAutocompleteAsync from '../demos/ui/ex-autocomplete-async';
import ExAutocompleteBasic from '../demos/ui/ex-autocomplete-basic';
import ExAutocompleteClearable from '../demos/ui/ex-autocomplete-clearable';
import ExAutocompleteControl from '../demos/ui/ex-autocomplete-control';
import ExAutocompleteDisabled from '../demos/ui/ex-autocomplete-disabled';
import ExAutocompleteFilter from '../demos/ui/ex-autocomplete-filter';
import ExAutocompleteMinChars from '../demos/ui/ex-autocomplete-min-chars';
import ExAutocompleteOptionShape from '../demos/ui/ex-autocomplete-option-shape';
import ExAutocompletePosition from '../demos/ui/ex-autocomplete-position';
import ExAutocompleteValueOninput from '../demos/ui/ex-autocomplete-value-oninput';
import ExBadgeClass from '../demos/ui/ex-badge-class';
import ExBadgeCount from '../demos/ui/ex-badge-count';
import ExBadgeLabel from '../demos/ui/ex-badge-label';
import ExBadgeMax from '../demos/ui/ex-badge-max';
import ExBadgePosition from '../demos/ui/ex-badge-position';
import ExBadgeVariants from '../demos/ui/ex-badge-variants';
import ExButtonAriaCurrent from '../demos/ui/ex-button-aria-current';
import ExButtonClass from '../demos/ui/ex-button-class';
import ExButtonContent from '../demos/ui/ex-button-content';
import ExButtonDisabled from '../demos/ui/ex-button-disabled';
import ExButtonEvents from '../demos/ui/ex-button-events';
import ExButtonToggleClass from '../demos/ui/ex-button-toggle-class';
import ExButtonToggleDisabled from '../demos/ui/ex-button-toggle-disabled';
import ExButtonToggleIcons from '../demos/ui/ex-button-toggle-icons';
import ExButtonToggleMulti from '../demos/ui/ex-button-toggle-multi';
import ExButtonToggleOptionDisabled from '../demos/ui/ex-button-toggle-option-disabled';
import ExButtonToggleSingle from '../demos/ui/ex-button-toggle-single';
import ExButtonType from '../demos/ui/ex-button-type';
import ExButtonVariants from '../demos/ui/ex-button-variants';
import ExCardClass from '../demos/ui/ex-card-class';
import ExCardInteractive from '../demos/ui/ex-card-interactive';
import ExCardMedia from '../demos/ui/ex-card-media';
import ExCardMinimal from '../demos/ui/ex-card-minimal';
import ExCardParts from '../demos/ui/ex-card-parts';
import ExCheckboxBasic from '../demos/ui/ex-checkbox-basic';
import ExCheckboxForms from '../demos/ui/ex-checkbox-forms';
import ExCheckboxName from '../demos/ui/ex-checkbox-name';
import ExCheckboxStates from '../demos/ui/ex-checkbox-states';
import ExCheckboxTristate from '../demos/ui/ex-checkbox-tristate';
import ExChipsAdd from '../demos/ui/ex-chips-add';
import ExChipsBasic from '../demos/ui/ex-chips-basic';
import ExChipsControl from '../demos/ui/ex-chips-control';
import ExChipsDisabled from '../demos/ui/ex-chips-disabled';
import ExChipsReadonly from '../demos/ui/ex-chips-readonly';
import ExChipsRemoveLabel from '../demos/ui/ex-chips-remove-label';
import ExDividerCustom from '../demos/ui/ex-divider-custom';
import ExDividerHorizontal from '../demos/ui/ex-divider-horizontal';
import ExDividerSemantic from '../demos/ui/ex-divider-semantic';
import ExDividerVertical from '../demos/ui/ex-divider-vertical';
import ExExpansionBasic from '../demos/ui/ex-expansion-basic';
import ExExpansionCustomClass from '../demos/ui/ex-expansion-custom-class';
import ExExpansionDefaultOpen from '../demos/ui/ex-expansion-default-open';
import ExExpansionDisabledAll from '../demos/ui/ex-expansion-disabled-all';
import ExExpansionDisabledPanel from '../demos/ui/ex-expansion-disabled-panel';
import ExExpansionHeadingLevel from '../demos/ui/ex-expansion-heading-level';
import ExExpansionRichBody from '../demos/ui/ex-expansion-rich-body';
import ExExpansionSingle from '../demos/ui/ex-expansion-single';
import ExFormFieldClass from '../demos/ui/ex-form-field-class';
import ExFormFieldControl from '../demos/ui/ex-form-field-control';
import ExFormFieldLabelHint from '../demos/ui/ex-form-field-label-hint';
import ExFormFieldManualError from '../demos/ui/ex-form-field-manual-error';
import ExFormFieldUnlabelled from '../demos/ui/ex-form-field-unlabelled';
import ExFormFieldWrapCheckbox from '../demos/ui/ex-form-field-wrap-checkbox';
import ExFormFieldWrapSelect from '../demos/ui/ex-form-field-wrap-select';
import ExIconColor from '../demos/ui/ex-icon-color';
import ExIconLabel from '../demos/ui/ex-icon-label';
import ExIconName from '../demos/ui/ex-icon-name';
import ExIconSrc from '../demos/ui/ex-icon-src';
import ExIconSvg from '../demos/ui/ex-icon-svg';
import ExProgressBarClass from '../demos/ui/ex-progress-bar-class';
import ExProgressBarDeterminate from '../demos/ui/ex-progress-bar-determinate';
import ExProgressBarIndeterminate from '../demos/ui/ex-progress-bar-indeterminate';
import ExProgressBarValues from '../demos/ui/ex-progress-bar-values';
import ExProgressSpinnerBasic from '../demos/ui/ex-progress-spinner-basic';
import ExProgressSpinnerClass from '../demos/ui/ex-progress-spinner-class';
import ExProgressSpinnerInButton from '../demos/ui/ex-progress-spinner-in-button';
import ExProgressSpinnerSizes from '../demos/ui/ex-progress-spinner-sizes';
import ExRadioBasic from '../demos/ui/ex-radio-basic';
import ExRadioDisabled from '../demos/ui/ex-radio-disabled';
import ExRadioForms from '../demos/ui/ex-radio-forms';
import ExRadioName from '../demos/ui/ex-radio-name';
import ExRippleBasic from '../demos/ui/ex-ripple-basic';
import ExRippleCentered from '../demos/ui/ex-ripple-centered';
import ExRippleDisabled from '../demos/ui/ex-ripple-disabled';
import ExRippleReactive from '../demos/ui/ex-ripple-reactive';
import ExSelectAdornments from '../demos/ui/ex-select-adornments';
import ExSelectBasic from '../demos/ui/ex-select-basic';
import ExSelectClearable from '../demos/ui/ex-select-clearable';
import ExSelectCustom from '../demos/ui/ex-select-custom';
import ExSelectMultiple from '../demos/ui/ex-select-multiple';
import ExSelectOptions from '../demos/ui/ex-select-options';
import ExSelectPosition from '../demos/ui/ex-select-position';
import ExSelectStates from '../demos/ui/ex-select-states';
import ExSelectValidation from '../demos/ui/ex-select-validation';
import ExSlideToggleBasic from '../demos/ui/ex-slide-toggle-basic';
import ExSlideToggleForms from '../demos/ui/ex-slide-toggle-forms';
import ExSlideToggleName from '../demos/ui/ex-slide-toggle-name';
import ExSlideToggleStates from '../demos/ui/ex-slide-toggle-states';
import ExSliderBasic from '../demos/ui/ex-slider-basic';
import ExSliderClass from '../demos/ui/ex-slider-class';
import ExSliderControl from '../demos/ui/ex-slider-control';
import ExSliderDisabled from '../demos/ui/ex-slider-disabled';
import ExSliderFormat from '../demos/ui/ex-slider-format';
import ExSliderRange from '../demos/ui/ex-slider-range';
import ExSliderStep from '../demos/ui/ex-slider-step';
import ExSliderUncontrolled from '../demos/ui/ex-slider-uncontrolled';
import ExTabsActivateOnFocus from '../demos/ui/ex-tabs-activate-on-focus';
import ExTabsBasic from '../demos/ui/ex-tabs-basic';
import ExTabsClass from '../demos/ui/ex-tabs-class';
import ExTabsContent from '../demos/ui/ex-tabs-content';
import ExTabsDisabled from '../demos/ui/ex-tabs-disabled';
import ExTabsDisabledAll from '../demos/ui/ex-tabs-disabled-all';
import ExTabsLabel from '../demos/ui/ex-tabs-label';
import ExTabsUncontrolled from '../demos/ui/ex-tabs-uncontrolled';
import ExToolbarClass from '../demos/ui/ex-toolbar-class';
import ExToolbarInk from '../demos/ui/ex-toolbar-ink';
import ExToolbarParts from '../demos/ui/ex-toolbar-parts';
import ExToolbarRole from '../demos/ui/ex-toolbar-role';
import ExToolbarSticky from '../demos/ui/ex-toolbar-sticky';

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
  'ex-autocomplete-async': ExAutocompleteAsync,
  'ex-autocomplete-basic': ExAutocompleteBasic,
  'ex-autocomplete-clearable': ExAutocompleteClearable,
  'ex-autocomplete-control': ExAutocompleteControl,
  'ex-autocomplete-disabled': ExAutocompleteDisabled,
  'ex-autocomplete-filter': ExAutocompleteFilter,
  'ex-autocomplete-min-chars': ExAutocompleteMinChars,
  'ex-autocomplete-option-shape': ExAutocompleteOptionShape,
  'ex-autocomplete-position': ExAutocompletePosition,
  'ex-autocomplete-value-oninput': ExAutocompleteValueOninput,
  'ex-badge-class': ExBadgeClass,
  'ex-badge-count': ExBadgeCount,
  'ex-badge-label': ExBadgeLabel,
  'ex-badge-max': ExBadgeMax,
  'ex-badge-position': ExBadgePosition,
  'ex-badge-variants': ExBadgeVariants,
  'ex-button-aria-current': ExButtonAriaCurrent,
  'ex-button-class': ExButtonClass,
  'ex-button-content': ExButtonContent,
  'ex-button-disabled': ExButtonDisabled,
  'ex-button-events': ExButtonEvents,
  'ex-button-toggle-class': ExButtonToggleClass,
  'ex-button-toggle-disabled': ExButtonToggleDisabled,
  'ex-button-toggle-icons': ExButtonToggleIcons,
  'ex-button-toggle-multi': ExButtonToggleMulti,
  'ex-button-toggle-option-disabled': ExButtonToggleOptionDisabled,
  'ex-button-toggle-single': ExButtonToggleSingle,
  'ex-button-type': ExButtonType,
  'ex-button-variants': ExButtonVariants,
  'ex-card-class': ExCardClass,
  'ex-card-interactive': ExCardInteractive,
  'ex-card-media': ExCardMedia,
  'ex-card-minimal': ExCardMinimal,
  'ex-card-parts': ExCardParts,
  'ex-checkbox-basic': ExCheckboxBasic,
  'ex-checkbox-forms': ExCheckboxForms,
  'ex-checkbox-name': ExCheckboxName,
  'ex-checkbox-states': ExCheckboxStates,
  'ex-checkbox-tristate': ExCheckboxTristate,
  'ex-chips-add': ExChipsAdd,
  'ex-chips-basic': ExChipsBasic,
  'ex-chips-control': ExChipsControl,
  'ex-chips-disabled': ExChipsDisabled,
  'ex-chips-readonly': ExChipsReadonly,
  'ex-chips-remove-label': ExChipsRemoveLabel,
  'ex-divider-custom': ExDividerCustom,
  'ex-divider-horizontal': ExDividerHorizontal,
  'ex-divider-semantic': ExDividerSemantic,
  'ex-divider-vertical': ExDividerVertical,
  'ex-expansion-basic': ExExpansionBasic,
  'ex-expansion-custom-class': ExExpansionCustomClass,
  'ex-expansion-default-open': ExExpansionDefaultOpen,
  'ex-expansion-disabled-all': ExExpansionDisabledAll,
  'ex-expansion-disabled-panel': ExExpansionDisabledPanel,
  'ex-expansion-heading-level': ExExpansionHeadingLevel,
  'ex-expansion-rich-body': ExExpansionRichBody,
  'ex-expansion-single': ExExpansionSingle,
  'ex-form-field-class': ExFormFieldClass,
  'ex-form-field-control': ExFormFieldControl,
  'ex-form-field-label-hint': ExFormFieldLabelHint,
  'ex-form-field-manual-error': ExFormFieldManualError,
  'ex-form-field-unlabelled': ExFormFieldUnlabelled,
  'ex-form-field-wrap-checkbox': ExFormFieldWrapCheckbox,
  'ex-form-field-wrap-select': ExFormFieldWrapSelect,
  'ex-icon-color': ExIconColor,
  'ex-icon-label': ExIconLabel,
  'ex-icon-name': ExIconName,
  'ex-icon-src': ExIconSrc,
  'ex-icon-svg': ExIconSvg,
  'ex-progress-bar-class': ExProgressBarClass,
  'ex-progress-bar-determinate': ExProgressBarDeterminate,
  'ex-progress-bar-indeterminate': ExProgressBarIndeterminate,
  'ex-progress-bar-values': ExProgressBarValues,
  'ex-progress-spinner-basic': ExProgressSpinnerBasic,
  'ex-progress-spinner-class': ExProgressSpinnerClass,
  'ex-progress-spinner-in-button': ExProgressSpinnerInButton,
  'ex-progress-spinner-sizes': ExProgressSpinnerSizes,
  'ex-radio-basic': ExRadioBasic,
  'ex-radio-disabled': ExRadioDisabled,
  'ex-radio-forms': ExRadioForms,
  'ex-radio-name': ExRadioName,
  'ex-ripple-basic': ExRippleBasic,
  'ex-ripple-centered': ExRippleCentered,
  'ex-ripple-disabled': ExRippleDisabled,
  'ex-ripple-reactive': ExRippleReactive,
  'ex-select-adornments': ExSelectAdornments,
  'ex-select-basic': ExSelectBasic,
  'ex-select-clearable': ExSelectClearable,
  'ex-select-custom': ExSelectCustom,
  'ex-select-multiple': ExSelectMultiple,
  'ex-select-options': ExSelectOptions,
  'ex-select-position': ExSelectPosition,
  'ex-select-states': ExSelectStates,
  'ex-select-validation': ExSelectValidation,
  'ex-slide-toggle-basic': ExSlideToggleBasic,
  'ex-slide-toggle-forms': ExSlideToggleForms,
  'ex-slide-toggle-name': ExSlideToggleName,
  'ex-slide-toggle-states': ExSlideToggleStates,
  'ex-slider-basic': ExSliderBasic,
  'ex-slider-class': ExSliderClass,
  'ex-slider-control': ExSliderControl,
  'ex-slider-disabled': ExSliderDisabled,
  'ex-slider-format': ExSliderFormat,
  'ex-slider-range': ExSliderRange,
  'ex-slider-step': ExSliderStep,
  'ex-slider-uncontrolled': ExSliderUncontrolled,
  'ex-tabs-activate-on-focus': ExTabsActivateOnFocus,
  'ex-tabs-basic': ExTabsBasic,
  'ex-tabs-class': ExTabsClass,
  'ex-tabs-content': ExTabsContent,
  'ex-tabs-disabled': ExTabsDisabled,
  'ex-tabs-disabled-all': ExTabsDisabledAll,
  'ex-tabs-label': ExTabsLabel,
  'ex-tabs-uncontrolled': ExTabsUncontrolled,
  'ex-toolbar-class': ExToolbarClass,
  'ex-toolbar-ink': ExToolbarInk,
  'ex-toolbar-parts': ExToolbarParts,
  'ex-toolbar-role': ExToolbarRole,
  'ex-toolbar-sticky': ExToolbarSticky,
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
