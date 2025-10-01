import { useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import type { Expense, Participant } from './types';
import { buildSettlementPlan, calculateBalances } from './utils/settlement';

const formatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0
});

type ParticipantFormValues = {
  name: string;
};

type ShareInput = {
  participantId: string;
  included: boolean;
  fixedAmount: string;
};

type ExpenseFormValues = {
  title: string;
  amount: string;
  payerId: string;
  shares: ShareInput[];
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 10)}`;
};

const createExpenseFormDefaults = (): ExpenseFormValues => ({
  title: '',
  amount: '',
  payerId: '',
  shares: []
});

function App() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const participantCounterRef = useRef(1);
  const expenseCounterRef = useRef(1);

  const participantForm = useForm<ParticipantFormValues>({
    defaultValues: { name: '' }
  });

  const {
    control,
    register,
    handleSubmit: handleExpenseSubmit,
    reset: resetExpenseForm,
    setValue,
    getValues,
    formState: { errors: expenseErrors },
    clearErrors,
    setError,
    watch
  } = useForm<ExpenseFormValues>({
    defaultValues: createExpenseFormDefaults()
  });

  const { fields: shareFields, append, remove, replace } = useFieldArray({
    control,
    name: 'shares'
  });

  const titleRegister = register('title');
  const { onChange: amountOnChange, ...amountRegister } = register('amount');

  const sharesWatch = watch('shares');

  const handleParticipantSubmit = participantForm.handleSubmit(({ name }) => {
    const trimmed = name.trim();
    const finalName = trimmed !== '' ? trimmed : `参加者${participantCounterRef.current}`;
    participantCounterRef.current += 1;

    const newParticipant: Participant = {
      id: createId(),
      name: finalName
    };

    setParticipants((prev) => [...prev, newParticipant]);
    append({ participantId: newParticipant.id, included: true, fixedAmount: '' });

    if (!getValues('payerId')) {
      setValue('payerId', newParticipant.id, { shouldDirty: false });
    }

    participantForm.reset({ name: '' });
    clearErrors(['shares', 'payerId']);
  });

  const handleRemoveParticipant = (id: string) => {
    const updatedParticipants = participants.filter((participant) => participant.id !== id);

    const index = shareFields.findIndex((share) => share.participantId === id);
    if (index !== -1) {
      remove(index);
    }

    setParticipants(updatedParticipants);
    setExpenses((prev) =>
      prev.reduce<Expense[]>((acc, expense) => {
        if (expense.payerId === id) {
          return acc;
        }
        const filteredShares = expense.shares.filter((share) => share.participantId !== id);
        if (filteredShares.length === 0) {
          return acc;
        }
        acc.push({ ...expense, shares: filteredShares });
        return acc;
      }, [])
    );

    if (updatedParticipants.length === 0) {
      resetExpenseForm(createExpenseFormDefaults());
      replace([]);
    } else if (getValues('payerId') === id) {
      setValue('payerId', updatedParticipants[0].id, { shouldDirty: true });
    }

    clearErrors();
  };

  const onSubmitExpense = (values: ExpenseFormValues) => {
    clearErrors();

    const amount = Math.round(Number(values.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('amount', { type: 'manual', message: '金額は1円以上の数値で入力してください' });
      return;
    }

    if (!values.payerId) {
      setError('payerId', { type: 'manual', message: '立替者を選択してください' });
      return;
    }

    const includedShares = values.shares.filter((share) => share.included);
    if (includedShares.length === 0) {
      setError('shares', { type: 'manual', message: '少なくとも1名の負担者を選択してください' });
      return;
    }

    const fixedEntries = includedShares.map((share) => {
      const raw = share.fixedAmount.trim();
      const parsed = raw === '' ? 0 : Math.max(0, Math.round(Number(raw)) || 0);
      return { participantId: share.participantId, amount: parsed };
    });

    const totalFixed = fixedEntries.reduce((sum, entry) => sum + entry.amount, 0);
    if (totalFixed > amount) {
      setError('shares', { type: 'manual', message: '固定額の合計が支出額を超えています' });
      return;
    }

    const flexibleIds = fixedEntries.filter((entry) => entry.amount === 0).map((entry) => entry.participantId);
    const remainder = amount - totalFixed;
    const shareAmounts = new Map<string, number>();

    fixedEntries
      .filter((entry) => entry.amount > 0)
      .forEach((entry) => {
        shareAmounts.set(entry.participantId, entry.amount);
      });

    if (flexibleIds.length === 0) {
      if (remainder !== 0) {
        setError('shares', { type: 'manual', message: '固定額の合計が支出額と一致していません' });
        return;
      }
    } else {
      if (remainder < 0) {
        setError('shares', { type: 'manual', message: '固定額の合計が支出額を超えています' });
        return;
      }
      const baseShare = Math.floor(remainder / flexibleIds.length);
      let extra = remainder - baseShare * flexibleIds.length;

      flexibleIds.forEach((participantId) => {
        let share = baseShare;
        if (extra > 0) {
          share += 1;
          extra -= 1;
        }
        shareAmounts.set(participantId, share);
      });
    }

    const allocatedTotal = Array.from(shareAmounts.values()).reduce((sum, value) => sum + value, 0);
    if (allocatedTotal !== amount) {
      setError('shares', {
        type: 'manual',
        message: '負担額の計算に失敗しました。入力内容を確認してください。'
      });
      return;
    }

    const trimmedTitle = values.title.trim();
    const title = trimmedTitle === '' ? `支出${expenseCounterRef.current}` : trimmedTitle;
    expenseCounterRef.current += 1;

    const newExpense: Expense = {
      id: createId(),
      title,
      amount,
      payerId: values.payerId,
      shares: includedShares.map((share) => ({
        participantId: share.participantId,
        amount: shareAmounts.get(share.participantId) ?? 0
      }))
    };

    setExpenses((prev) => [newExpense, ...prev]);

    resetExpenseForm({
      title: '',
      amount: '',
      payerId: values.payerId,
      shares: values.shares.map((share) => ({
        participantId: share.participantId,
        included: share.included,
        fixedAmount: ''
      }))
    });
  };

  const handleRemoveExpense = (id: string) => {
    setExpenses((prev) => prev.filter((expense) => expense.id !== id));
  };

  const totalSpent = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );

  const balances = useMemo(
    () => calculateBalances(participants, expenses),
    [participants, expenses]
  );

  const settlements = useMemo(
    () => buildSettlementPlan(balances),
    [balances]
  );

  const findParticipantName = (id: string) => participants.find((p) => p.id === id)?.name ?? '不明';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-primary">割り勘計算アプリ（MVP）</h1>
        <p className="text-sm text-slate-600">
          参加者を追加し、支出を登録すると精算結果が自動で計算されます。精算結果は1円単位で表示されます。
        </p>
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">参加者</h2>
          <form onSubmit={handleParticipantSubmit} className="mt-4 flex gap-2">
            <input
              type="text"
              placeholder="参加者名（未入力でも追加可）"
              className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              {...participantForm.register('name')}
            />
            <button
              type="submit"
              className="rounded bg-primary px-3 py-2 text-sm font-semibold text-white"
            >
              追加
            </button>
          </form>

          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {participants.length === 0 ? (
              <li className="text-slate-500">参加者を追加してください。</li>
            ) : (
              participants.map((participant) => (
                <li
                  key={participant.id}
                  className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
                >
                  <span>{participant.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveParticipant(participant.id)}
                    className="text-xs font-semibold text-red-500 hover:underline"
                  >
                    削除
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">支出登録</h2>
          <form onSubmit={handleExpenseSubmit(onSubmitExpense)} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500">項目名</label>
              <input
                type="text"
                placeholder="例: 夕食（未入力で自動命名）"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                {...titleRegister}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500">金額 (円)</label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                {...amountRegister}
                onChange={(event) => {
                  amountOnChange(event);
                  clearErrors(['amount', 'shares']);
                }}
              />
              {expenseErrors.amount && (
                <p className="mt-1 text-xs text-red-500">{expenseErrors.amount.message}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500">立替者</label>
              <Controller
                control={control}
                name="payerId"
                render={({ field }) => (
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    value={field.value}
                    onChange={(event) => {
                      field.onChange(event.target.value);
                      clearErrors('payerId');
                    }}
                  >
                    {participants.length === 0 && <option value="">参加者を追加してください</option>}
                    {participants.map((participant) => (
                      <option key={participant.id} value={participant.id}>
                        {participant.name}
                      </option>
                    ))}
                  </select>
                )}
              />
              {expenseErrors.payerId && (
                <p className="mt-1 text-xs text-red-500">{expenseErrors.payerId.message}</p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500">負担者・固定額 (未入力は均等割)</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {shareFields.map((field, index) => {
                  const participant = participants.find((item) => item.id === field.participantId);
                  if (!participant) {
                    return null;
                  }

                  const included = sharesWatch?.[index]?.included ?? true;

                  return (
                    <div
                      key={field.id}
                      className={`flex w-full flex-col gap-1 rounded border px-3 py-2 sm:w-[calc(50%-0.75rem)] ${
                        included ? 'border-primary/60 bg-primary/5' : 'border-slate-200'
                      }`}
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <Controller
                          control={control}
                          name={`shares.${index}.included`}
                          defaultValue={field.included}
                          render={({ field: controllerField }) => (
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={controllerField.value ?? false}
                              onChange={(event) => {
                                const nextChecked = event.target.checked;
                                controllerField.onChange(nextChecked);
                                if (!nextChecked) {
                                  setValue(`shares.${index}.fixedAmount`, '');
                                }
                                clearErrors('shares');
                              }}
                            />
                          )}
                        />
                        {participant.name}
                      </label>
                      <Controller
                        control={control}
                        name={`shares.${index}.fixedAmount`}
                        defaultValue={field.fixedAmount}
                        render={({ field: controllerField }) => (
                          <input
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={controllerField.value ?? ''}
                            onChange={(event) => {
                              controllerField.onChange(event.target.value);
                              clearErrors('shares');
                            }}
                            placeholder="固定額 (任意)"
                            className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-primary focus:outline-none disabled:bg-slate-100"
                            disabled={!included}
                          />
                        )}
                      />
                    </div>
                  );
                })}
                {participants.length === 0 && (
                  <span className="text-xs text-slate-500">参加者が必要です</span>
                )}
              </div>
              {expenseErrors.shares && (
                <p className="mt-1 text-xs text-red-500">{expenseErrors.shares.message}</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full rounded bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={participants.length === 0}
            >
              支出を追加
            </button>
          </form>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">登録済み支出</h2>
          <p className="text-sm text-slate-600">合計: {formatter.format(totalSpent)}</p>
        </div>
        {expenses.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">まだ支出が登録されていません。</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {expenses.map((expense) => (
              <li
                key={expense.id}
                className="flex flex-col justify-between gap-2 rounded border border-slate-200 p-3 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="font-semibold text-slate-800">{expense.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatter.format(expense.amount)} / 立替: {findParticipantName(expense.payerId)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveExpense(expense.id)}
                  className="self-start text-xs font-semibold text-red-500 hover:underline"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">精算サマリー</h2>
        {participants.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">参加者を追加すると精算結果が表示されます。</p>
        ) : (
          <div className="mt-4">
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2">参加者</th>
                    <th className="py-2">立替額</th>
                    <th className="py-2">負担額</th>
                    <th className="py-2">差額</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((balance) => {
                    return (
                      <tr key={balance.participant.id} className="border-b last:border-none">
                        <td className="py-2 font-medium">{balance.participant.name}</td>
                        <td className="py-2">{formatter.format(balance.paid)}</td>
                        <td className="py-2">{formatter.format(balance.shouldPay)}</td>
                        <td className={`py-2 ${balance.diff >= 0 ? 'text-teal-600' : 'text-red-600'}`}>
                          {formatter.format(balance.diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="space-y-3 md:hidden">
              {balances.map((balance) => {
                return (
                  <li
                    key={balance.participant.id}
                    className="rounded border border-slate-200 bg-slate-50 px-3 py-3 text-sm"
                  >
                    <p className="text-sm font-semibold text-slate-800">{balance.participant.name}</p>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-500">
                      <span>立替額</span>
                      <span className="text-right font-medium text-slate-700">{formatter.format(balance.paid)}</span>
                      <span>負担額</span>
                      <span className="text-right font-medium text-slate-700">{formatter.format(balance.shouldPay)}</span>
                      <span>差額</span>
                      <span className={`text-right font-semibold ${balance.diff >= 0 ? 'text-teal-600' : 'text-red-600'}`}>
                        {formatter.format(balance.diff)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">最終支払フロー</h2>
        {settlements.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">差額が発生していません。</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {settlements.map((settlement) => (
              <li key={`${settlement.from}-${settlement.to}`} className="rounded border border-primary/30 bg-primary/5 px-3 py-2">
                {findParticipantName(settlement.from)} → {findParticipantName(settlement.to)} :{' '}
                <span className="font-semibold">{formatter.format(settlement.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default App;
