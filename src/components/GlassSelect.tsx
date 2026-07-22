import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { memo, type ReactNode } from 'react'

export interface GlassSelectOption {
  value: string
  label: ReactNode
  textValue?: string
  disabled?: boolean
}

interface GlassSelectProps {
  value?: string
  onValueChange(value: string): void
  options: GlassSelectOption[]
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  contentClassName?: string
  size?: 'compact' | 'regular'
}

export const GlassSelect = memo(function GlassSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder = '请选择',
  disabled = false,
  className = '',
  contentClassName = '',
  size = 'regular',
}: GlassSelectProps) {
  const selected = options.find((option) => option.value === value)
  return <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <Select.Trigger aria-label={ariaLabel} className={`glass-select-trigger ${size} ${className}`.trim()}>
      <Select.Value placeholder={placeholder}>{selected?.label}</Select.Value>
      <Select.Icon className="glass-select-chevron"><ChevronDown size={15} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className={`glass-select-content ${contentClassName}`.trim()} position="popper" sideOffset={6} collisionPadding={12}>
        <Select.ScrollUpButton className="glass-select-scroll"><ChevronUp size={14} /></Select.ScrollUpButton>
        <Select.Viewport className="glass-select-viewport">
          {options.map((option) => <Select.Item
            key={option.value}
            value={option.value}
            textValue={option.textValue || (typeof option.label === 'string' ? option.label : option.value)}
            disabled={option.disabled}
            className="glass-select-item"
          >
            <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
            <Select.ItemText>{option.label}</Select.ItemText>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="glass-select-scroll"><ChevronDown size={14} /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
})
