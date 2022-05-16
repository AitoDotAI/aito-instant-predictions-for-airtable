declare module 'multivariate-gaussian' {
  class Gaussian {
    constructor(params: {
      mu: Float64Array | Float32Array | number[]
      sigma: (Float64Array | Float32Array | number[])[]
    })
    public density(point: Float64Array | Float32Array | number[]): number
  }
  export = Gaussian
}

declare module 'numeric' {
  export function inv(mat: number[][]): number[][]
  export function dotMV(A: number[][], x: number[]): number[]
}
