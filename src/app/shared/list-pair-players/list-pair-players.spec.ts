import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListPairPlayers } from './list-pair-players';

describe('ListPairPlayers', () => {
  let component: ListPairPlayers;
  let fixture: ComponentFixture<ListPairPlayers>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListPairPlayers]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListPairPlayers);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
