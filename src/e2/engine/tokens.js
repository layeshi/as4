// SPEC-P4: conversion is world-local; historical worlds retain their exact units.
import { P } from '../params.js';
import { tokenized } from '../world.js';
export const K = (w) => tokenized(w) ? w.tokens.k : 1;
export const ep = (w, key) => P[key] * K(w);
