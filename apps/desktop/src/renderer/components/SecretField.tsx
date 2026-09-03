import { Input } from '@cloudflare/kumo';

type SecretFieldProps = {
  value: string;
  onValueChange(value: string): void;
  error?: string;
  storedMask?: string;
  disabled?: boolean;
};

/** Keeps a credential exclusively in the caller's component-local password state. */
export function SecretField({ value, onValueChange, error, storedMask, disabled }: SecretFieldProps) {
  return (
    <div className="secret-field">
      <Input
        id="api-key"
        label="API key"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        error={error}
        disabled={disabled}
        description="Stored only while this form is open and cleared after a successful save."
      />
      {storedMask !== undefined ? <p className="stored-secret">Stored key: {storedMask}</p> : null}
    </div>
  );
}
