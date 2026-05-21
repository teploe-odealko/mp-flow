# Routing `operationType` Ozon в `eventType`

Этот документ фиксирует, как мы маршрутизируем финансовые операции Ozon в `ExternalEvent.eventType`.

## Зачем это нужно

`eventType` у нас отвечает не за "как Ozon назвал операцию", а за то, **в какой pipeline событие должно пойти**:

- `sale` -> продажа
- `return` -> возврат
- `fee` -> расход/доход канала
- `payout` -> выплата продавцу

Исторически у нас был слишком грубый fallback: положительная сумма без явного sale-breakdown шла в `payout`.
Это приводило к ошибкам на операциях вроде `MarketplaceRedistributionOfAcquiringOperation`, где есть `postingNumber`, но сумма положительная.

## Текущее правило

Приоритет такой:

1. явный mapping по `operationType`
2. special-case для sale settlement (`OperationAgentDeliveredToCustomer`)
3. узкий fallback в `payout` только для payout-like операций без `postingNumber`, `items`, `services`
4. всё остальное -> `fee`

## Явно поддерживаемые `operationType`

### `expand_only`

Эти операции не идут как один `ExternalEvent`, а разворачиваются в несколько `fee`-компонентов:

| operationType | Route |
| --- | --- |
| `OperationAgentDeliveredToCustomer` | `expand_only` |

### `fee`

Эти операции всегда маршрутизируются в `fee`, независимо от знака суммы:

| operationType | Route |
| --- | --- |
| `MarketplaceRedistributionOfAcquiringOperation` | `fee` |
| `CustomerReviews` | `fee` |
| `OperationItemReturn` | `fee` |
| `InsuranceServiceSellerItem` | `fee` |
| `MarketplaceServiceItemCrossdocking` | `fee` |
| `OperationPointsForReviews` | `fee` |
| `OperationMarketplaceSupplyAdditional` | `fee` |
| `OperationMarketplaceSupplyExpirationDateProcessing` | `fee` |
| `OperationMarketplaceCostPerClick` | `fee` |
| `OperationMarketplaceServiceSupplyInboundCargoShortage` | `fee` |
| `OperationMarketplaceItemTemporaryStorageRedistribution` | `fee` |
| `DisposalReasonDamagedPackaging` | `fee` |
| `SellerReturnsDeliveryToPickupPoint` | `fee` |
| `OperationSubscriptionPremium` | `fee` |
| `OperationSellerReturnsCargoAssortmentInvalid` | `fee` |
| `OperationMarketplaceAcceleratedProductReviews` | `fee` |
| `MarketplaceSellerInstallmentOperation` | `fee` |
| `DisposalReasonFailedToPickupOnTime` | `fee` |

## `payout`

Сейчас `payout` intentionally narrow.

Операция считается payout только если одновременно:

- не попала в explicit mapping выше,
- не является sale settlement,
- у неё нет `postingNumber`,
- у неё нет `items`,
- у неё нет `services`,
- и текст операции явно похож на выплату (`payout`, `выплат`, `перечис`, `settlement`).

Это сделано специально: ошибка в сторону `fee` безопаснее, чем ошибка в сторону `payout`.

## Наблюдаемый список `operationType` в живых данных канала

На базе текущего локального Ozon канала (`channel_000066`) у нас наблюдались:

- `OperationAgentDeliveredToCustomer`
- `MarketplaceRedistributionOfAcquiringOperation`
- `CustomerReviews`
- `OperationItemReturn`
- `InsuranceServiceSellerItem`
- `MarketplaceServiceItemCrossdocking`
- `OperationPointsForReviews`
- `OperationMarketplaceSupplyAdditional`
- `OperationMarketplaceSupplyExpirationDateProcessing`
- `OperationMarketplaceCostPerClick`
- `OperationMarketplaceServiceSupplyInboundCargoShortage`
- `OperationMarketplaceItemTemporaryStorageRedistribution`
- `DisposalReasonDamagedPackaging`
- `SellerReturnsDeliveryToPickupPoint`
- `OperationSubscriptionPremium`
- `OperationSellerReturnsCargoAssortmentInvalid`
- `OperationMarketplaceAcceleratedProductReviews`
- `MarketplaceSellerInstallmentOperation`
- `DisposalReasonFailedToPickupOnTime`

Если появляется новый `operationType`, его нужно:

1. явно добавить в mapping,
2. отнести к `fee` или `payout`,
3. отдельно определить accounting classification (`category` / `treatment`).
