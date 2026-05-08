import { BigNumber } from '@ethersproject/bignumber';

export function normalize(value, decimals) {
    if (!value) return 0;
    const precision = BigNumber.from(10).pow(decimals);
    // Integer division!!!
    return parseFloat(BigNumber.from(value).div(precision).toString());
}

console.log(normalize("123450000", 6));
console.log(normalize("6545419439999999279104", 18));
