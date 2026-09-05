export function toRendererSafeTraceDetails(
  type: string,
  details: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'condition.evaluated') {
    const result = details.result === true || details.result === false || details.result === 'unknown'
      ? details.result
      : undefined;
    const reason = safeTraceToken(details.reason);
    const inputs = Array.isArray(details.inputs)
      ? details.inputs.slice(0, 3).flatMap((candidate) => {
        const input = record(candidate);
        const ref = safeTraceToken(input?.ref);
        const field = safeTraceToken(input?.field);
        return ref === undefined ? [] : [{ ref, ...(field === undefined ? {} : { field }) }];
      })
      : [];
    return {
      ...(result === undefined ? {} : { result }),
      ...(reason === undefined ? {} : { reason }),
      ...(inputs.length === 0 ? {} : { inputs }),
    };
  }
  if (type === 'action.proposed') {
    const effect = safeTraceEffect(details.effect);
    return effect === undefined ? {} : { effect };
  }
  if (type === 'risk.approved' || type === 'risk.rejected') {
    const violatedRuleIds = safeTraceTokenList(details.violatedRuleIds ?? details.riskRuleIds);
    return violatedRuleIds.length === 0 ? {} : { violatedRuleIds };
  }
  return {};
}

function safeTraceEffect(value: unknown): Record<string, unknown> | undefined {
  const effect = record(value);
  const config = record(effect?.config);
  if (effect === undefined || config === undefined) return undefined;
  const market = safeTraceToken(effect.market);
  if (effect.type === 'execution.open_position') {
    const side = config.side === 'long' || config.side === 'short' ? config.side : undefined;
    if (side === undefined) return undefined;
    const size = record(config.size);
    const sizeValue = finitePositiveNumber(size?.value);
    const safeSize = (size?.type === 'quote' || size?.type === 'equity_percent') && sizeValue !== undefined
      ? { type: size.type, value: sizeValue }
      : undefined;
    const leverage = finitePositiveNumber(config.leverage);
    return {
      type: effect.type,
      ...(market === undefined ? {} : { market }),
      config: {
        side,
        ...(safeSize === undefined ? {} : { size: safeSize }),
        ...(leverage === undefined ? {} : { leverage }),
      },
    };
  }
  if (effect.type === 'execution.close_position') {
    const side = config.side === 'long' || config.side === 'short' ? config.side : undefined;
    const percent = finitePositiveNumber(config.percent);
    if (percent === undefined || percent > 100) return undefined;
    return {
      type: effect.type,
      ...(market === undefined ? {} : { market }),
      config: { ...(side === undefined ? {} : { side }), percent },
    };
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeTraceToken(value: unknown): string | undefined {
  return typeof value === 'string'
    && /^[a-z0-9_.:-]{1,80}$/i.test(value)
    && !/authorization|api[-_]?key|private[-_]?key|secret|password|credential/i.test(value)
    ? value
    : undefined;
}

function safeTraceTokenList(value: unknown): string[] {
  return Array.isArray(value) ? value.slice(0, 3).flatMap((item) => safeTraceToken(item) ?? []) : [];
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
